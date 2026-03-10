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

    // 4. ✅ CORRECCIÓN #2: Buscar usuario con paginación correcta (soporta más de 50 usuarios)
    // Intentar primero con perPage alto para evitar múltiples llamadas
    let targetUser = null
    let page = 1
    const perPage = 1000

    while (!targetUser) {
      const { data: usersPage, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      })

      if (listError) {
        console.error('❌ Error listando usuarios:', listError)
        throw listError
      }

      // Buscar en esta página (case insensitive)
      targetUser = usersPage.users.find(
        u => u.email?.toLowerCase() === userEmail.toLowerCase()
      ) || null

      // Si ya no hay más usuarios o encontramos al usuario, salir
      if (usersPage.users.length < perPage || targetUser) break

      page++

      // Límite de seguridad: máximo 10 páginas (10,000 usuarios)
      if (page > 10) break
    }

    if (!targetUser) {
      console.error('❌ Usuario no encontrado:', userEmail)
      return new Response(
        JSON.stringify({ error: `Usuario no encontrado: ${userEmail}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`✅ Usuario encontrado: ${targetUser.id}`)
    console.log('🔄 Actualizando contraseña...')

    // 5. Actualizar la contraseña usando Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.id,
      {
        password: newPassword,
        email_confirm: true // Asegurar que el email está confirmado
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
          target_user_id: targetUser.id,
          timestamp: new Date().toISOString(),
          details: `Password reset by ${callerProfile.role} (${callerUser.id}) via Edge Function`
        })
    } catch (logError) {
      console.warn('⚠️ No se pudo crear log de auditoría (tabla no existe):', logError)
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
