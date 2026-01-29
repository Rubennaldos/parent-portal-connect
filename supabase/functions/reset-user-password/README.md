# Edge Function: Reset User Password

## Descripción
Esta Edge Function permite a los administradores resetear contraseñas de usuarios sin necesidad de correo electrónico.

## Uso

### Endpoint
```
POST https://YOUR_PROJECT.supabase.co/functions/v1/reset-user-password
```

### Headers
```
Authorization: Bearer YOUR_USER_JWT_TOKEN
Content-Type: application/json
```

### Body
```json
{
  "userEmail": "usuario@example.com",
  "newPassword": "nuevaContraseña123"
}
```

### Respuesta Exitosa
```json
{
  "success": true,
  "message": "Contraseña actualizada exitosamente",
  "userEmail": "usuario@example.com"
}
```

### Respuesta de Error
```json
{
  "error": "Mensaje de error"
}
```

## Despliegue

### 1. Instalar Supabase CLI
```bash
npm install -g supabase
```

### 2. Login en Supabase
```bash
supabase login
```

### 3. Link al proyecto
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### 4. Deploy de la función
```bash
supabase functions deploy reset-user-password
```

## Variables de Entorno
La función usa automáticamente estas variables que Supabase proporciona:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (clave de admin)
- `SUPABASE_ANON_KEY`

## Seguridad
- ⚠️ Solo usuarios autenticados pueden llamar a esta función
- ⚠️ Verificar roles en el frontend antes de permitir el acceso
- ✅ Usa el Admin API de Supabase (service_role key)
- ✅ No expone credenciales en el cliente
