import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejar preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔐 Edge Function: reset-user-password iniciada')

    // 1. Obtener el cuerpo de la petición
    const { userEmail, newPassword } = await req.json()

    // 2. Validaciones básicas
    if (!userEmail || !newPassword) {
      return new Response(
        JSON.stringify({ error: 'Email y contraseña son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. ✅ CORRECCIÓN #1: Verificar que el caller esté autenticado y tenga rol permitido
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No autorizado: falta token de autenticación' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Crear cliente con anon key para verificar el token del caller
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { data: { user: callerUser }, error: callerError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (callerError || !callerUser) {
      console.error('❌ Token inválido:', callerError)
      return new Response(
        JSON.stringify({ error: 'Token inválido o expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Crear cliente admin para verificar el rol y hacer operaciones privilegiadas
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar rol del caller en la tabla profiles
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (profileError || !callerProfile) {
      console.error('❌ No se pudo verificar el rol:', profileError)
      return new Response(
        JSON.stringify({ error: 'No se pudo verificar los permisos del administrador' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const allowedRoles = ['admin_general', 'superadmin']
    if (!allowedRoles.includes(callerProfile.role)) {
      console.error('❌ Rol no permitido:', callerProfile.role)
      return new Response(
        JSON.stringify({ error: `Acceso denegado. Solo administradores pueden resetear contraseñas. Tu rol: ${callerProfile.role}` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`✅ Caller verificado: ${callerUser.id} (${callerProfile.role})`)
    console.log(`🔍 Buscando usuario: ${userEmail}`)

    // 4. Buscar el ID del usuario directamente desde public.profiles (más rápido que listUsers)
    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .ilike('email', userEmail.trim())
      .single()

    if (targetProfileError || !targetProfile) {
      console.error('❌ Usuario no encontrado en profiles:', targetProfileError)
      return new Response(
        JSON.stringify({ error: `Usuario no encontrado: ${userEmail}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const targetUserId = targetProfile.id
    console.log(`✅ Usuario encontrado: ${targetUserId}`)
    console.log('🔄 Actualizando contraseña...')

    // 5. Actualizar la contraseña usando Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      {
        password: newPassword,
        email_confirm: true
      }
    )

    if (updateError) {
      console.error('❌ Error actualizando contraseña:', updateError)
      throw updateError
    }

    console.log(`✅ Contraseña actualizada exitosamente para: ${userEmail}`)

    // 6. Registrar en auditoría (no falla si la tabla no existe)
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          action: 'reset_password',
          admin_user_id: callerUser.id,
          target_user_email: userEmail,
          target_user_id: targetUserId,
          timestamp: new Date().toISOString(),
          details: `Password reset by ${callerProfile.role} (${callerUser.id}) via Edge Function`
        })
    } catch (logError) {
      console.warn('⚠️ No se pudo crear log de auditoría:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Contraseña actualizada exitosamente',
        userEmail: userEmail
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Error general:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Error interno al resetear contraseña'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
