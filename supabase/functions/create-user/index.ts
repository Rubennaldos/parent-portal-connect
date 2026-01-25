// ====================================================================================================
// EDGE FUNCTION: create-user
//
// Esta función crea usuarios desde el servidor sin afectar la sesión del admin
// ====================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Crear cliente de Supabase con Service Role Key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Obtener datos del request
    const { 
      email, 
      password, 
      full_name, 
      role,
      school_id,
      pos_number,
      ticket_prefix,
      dni,
      phone_1,
      address,
      nickname
    } = await req.json()

    console.log('📝 Creando usuario:', { email, role })

    // 1. Crear usuario en auth.users (usando Admin API)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirmar email
      user_metadata: {
        full_name: full_name,
        role: role,
      }
    })

    if (authError) {
      console.error('❌ Error creando usuario en auth:', authError)
      throw authError
    }

    console.log('✅ Usuario creado en auth:', authData.user.id)

    // 2. Esperar un poco para que el trigger cree el perfil
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 3. Actualizar el perfil con los datos específicos
    const profileData: any = {
      role: role,
      school_id: role !== 'supervisor_red' ? school_id : null,
    }

    // Datos específicos por rol
    if (role === 'operador_caja') {
      profileData.pos_number = pos_number
      profileData.ticket_prefix = ticket_prefix
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileData)
      .eq('id', authData.user.id)

    if (profileError) {
      console.error('⚠️ Error actualizando perfil:', profileError)
      // No lanzar error, continuar
    }

    // 4. Si es padre, crear parent_profile
    if (role === 'parent') {
      const { error: parentError } = await supabaseAdmin
        .from('parent_profiles')
        .insert({
          user_id: authData.user.id,
          school_id: school_id,
          dni: dni,
          phone_1: phone_1,
          address: address,
          nickname: nickname || null,
          full_name: full_name,
        })

      if (parentError) {
        console.error('⚠️ Error creando parent_profile:', parentError)
        // No lanzar error, continuar
      }
    }

    console.log('✅ Perfil completado para:', authData.user.id)

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: authData.user,
        message: 'Usuario creado exitosamente'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    console.error('❌ Error en create-user:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
