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
    console.log('🔐 Edge Function: reset-user-password iniciada');

    // Obtener el cuerpo de la petición
    const { userEmail, newPassword } = await req.json();

    console.log('📧 Email del usuario:', userEmail);

    // Validaciones
    if (!userEmail || !newPassword) {
      console.error('❌ Faltan parámetros: userEmail o newPassword');
      return new Response(
        JSON.stringify({ error: 'Email y contraseña son requeridos' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (newPassword.length < 6) {
      console.error('❌ Contraseña muy corta');
      return new Response(
        JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Crear cliente de Supabase con service_role key (Admin API)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log('🔍 Buscando usuario por email...');

    // Buscar el usuario por email usando Admin API
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      console.error('❌ Error listando usuarios:', listError);
      throw listError;
    }

    const user = users.users.find(u => u.email === userEmail);

    if (!user) {
      console.error('❌ Usuario no encontrado:', userEmail);
      return new Response(
        JSON.stringify({ error: 'Usuario no encontrado' }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('✅ Usuario encontrado:', user.id);
    console.log('🔄 Actualizando contraseña...');

    // Actualizar la contraseña del usuario usando Admin API
    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { 
        password: newPassword,
        email_confirm: true // Asegurar que el email está confirmado
      }
    );

    if (updateError) {
      console.error('❌ Error actualizando contraseña:', updateError);
      throw updateError;
    }

    console.log('✅ Contraseña actualizada exitosamente para:', userEmail);

    // Registrar la acción en logs (opcional)
    const authHeader = req.headers.get('Authorization');
    let adminUserId = 'unknown';
    
    if (authHeader) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      );
      
      const { data: { user: adminUser } } = await supabaseClient.auth.getUser(
        authHeader.replace('Bearer ', '')
      );
      
      if (adminUser) {
        adminUserId = adminUser.id;
      }
    }

    // Insertar log en tabla de auditoría (si existe)
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          action: 'reset_password',
          admin_user_id: adminUserId,
          target_user_email: userEmail,
          target_user_id: user.id,
          timestamp: new Date().toISOString(),
          details: 'Password reset by admin via Edge Function'
        });
    } catch (logError) {
      // No fallar si no existe la tabla de logs
      console.warn('⚠️ No se pudo crear log de auditoría:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Contraseña actualizada exitosamente',
        userEmail: userEmail
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Error general:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Error al resetear contraseña',
        details: error
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
})
