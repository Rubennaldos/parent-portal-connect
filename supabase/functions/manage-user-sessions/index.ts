import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verificar token del admin que llama
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No autorizado: falta token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { data: { user: callerUser }, error: callerError } = await supabaseAnon.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Token inválido o expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar que el caller es admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    const allowedRoles = ['admin_general', 'superadmin']
    if (!callerProfile || !allowedRoles.includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Acceso denegado. Solo superadmin y admin_general.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const { action, targetUserId, sessionId } = body

    // ─── ACTION: list_sessions ───────────────────────────────────
    if (action === 'list_sessions') {
      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: 'targetUserId es requerido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Supabase Auth Admin API: obtener usuario (incluye metadatos de sesión)
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(targetUserId)

      if (userError || !userData?.user) {
        return new Response(
          JSON.stringify({ error: 'Usuario no encontrado' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Consultar auth.sessions directamente (vista interna de Supabase)
      const { data: sessions, error: sessErr } = await supabaseAdmin
        .from('auth.sessions')
        .select('id, user_id, created_at, updated_at, factor_id, aal, not_after, refreshed_at, user_agent, ip')
        .eq('user_id', targetUserId)
        .order('updated_at', { ascending: false })

      if (sessErr) {
        // Si auth.sessions no es accesible directamente, devolver info básica del usuario
        console.warn('No se pudo acceder a auth.sessions:', sessErr.message)
        return new Response(
          JSON.stringify({
            sessions: [],
            user: {
              id: userData.user.id,
              email: userData.user.email,
              last_sign_in_at: userData.user.last_sign_in_at,
              created_at: userData.user.created_at,
            },
            note: 'La tabla de sesiones no es accesible directamente. Puedes cerrar todas las sesiones del usuario.'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          sessions: sessions || [],
          user: {
            id: userData.user.id,
            email: userData.user.email,
            last_sign_in_at: userData.user.last_sign_in_at,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ─── ACTION: sign_out_all ────────────────────────────────────
    if (action === 'sign_out_all') {
      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: 'targetUserId es requerido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(targetUserId, 'global')

      if (signOutError) {
        console.error('Error cerrando sesiones:', signOutError)
        throw signOutError
      }

      // Log de auditoría
      try {
        await supabaseAdmin.from('audit_logs').insert({
          action: 'force_sign_out_all',
          admin_user_id: callerUser.id,
          target_user_id: targetUserId,
          timestamp: new Date().toISOString(),
          details: `All sessions closed by ${callerProfile.role} (${callerUser.id})`
        })
      } catch (_) { /* tabla audit opcional */ }

      return new Response(
        JSON.stringify({ success: true, message: 'Todas las sesiones cerradas' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ─── ACTION: sign_out_session ────────────────────────────────
    if (action === 'sign_out_session') {
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'sessionId es requerido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Cerrar sesión específica: invalidar el refresh token de esa sesión
      const { error: delErr } = await supabaseAdmin
        .from('auth.sessions')
        .delete()
        .eq('id', sessionId)

      if (delErr) {
        // Fallback: cerrar todas si no se puede cerrar una sola
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(targetUserId, 'global')
        if (signOutError) throw signOutError
        return new Response(
          JSON.stringify({ success: true, message: 'Sesión cerrada (se cerraron todas por compatibilidad)' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Sesión cerrada correctamente' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ─── ACTION: generate_magic_link ────────────────────────────
    // Solo superadmin puede generar magic links (seguridad máxima)
    if (action === 'generate_magic_link') {
      if (callerProfile.role !== 'superadmin') {
        return new Response(
          JSON.stringify({ error: 'Solo el superadmin puede generar links de acceso directo.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: 'targetUserId es requerido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Obtener el email del usuario objetivo
      const { data: targetUserData, error: targetErr } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
      if (targetErr || !targetUserData?.user?.email) {
        return new Response(
          JSON.stringify({ error: 'Usuario no encontrado o sin email' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Generar magic link (OTP) para ese usuario
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: targetUserData.user.email,
        options: {
          redirectTo: Deno.env.get('SITE_URL') || 'https://parent-portal-connect.vercel.app',
        }
      })

      if (linkErr || !linkData?.properties?.action_link) {
        console.error('Error generando magic link:', linkErr)
        return new Response(
          JSON.stringify({ error: linkErr?.message || 'No se pudo generar el link' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Log de auditoría
      try {
        await supabaseAdmin.from('audit_logs').insert({
          action: 'impersonate_magic_link_generated',
          admin_user_id: callerUser.id,
          target_user_id: targetUserId,
          target_user_email: targetUserData.user.email,
          timestamp: new Date().toISOString(),
          details: `Magic link generado para impersonacion por superadmin (${callerUser.id})`
        })
      } catch (_) { /* tabla audit opcional */ }

      return new Response(
        JSON.stringify({
          success: true,
          magic_link: linkData.properties.action_link,
          email: targetUserData.user.email,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: `Acción desconocida: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error general:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Error interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
