# 🚀 GUÍA DE DESPLIEGUE: Edge Function Reset Password

## ⚠️ IMPORTANTE
Para que el sistema de reseteo de contraseñas funcione, DEBES desplegar esta Edge Function en Supabase.

---

## 📋 PASOS PARA DESPLEGAR

### **OPCIÓN 1: Usando Supabase Dashboard (MÁS FÁCIL) ⭐**

1. **Ve al Dashboard de Supabase:**
   - Abre https://supabase.com/dashboard
   - Selecciona tu proyecto: `parent-portal-connect`

2. **Navega a Edge Functions:**
   - En el menú izquierdo, busca "Edge Functions"
   - Click en "Create a new function"

3. **Crear la función:**
   - **Name:** `reset-user-password`
   - Click en "Create function"

4. **Copiar el código:**
   - Abre el archivo: `supabase/functions/reset-user-password/index.ts`
   - Copia TODO el contenido
   - Pega en el editor del Dashboard de Supabase

5. **Deploy:**
   - Click en "Deploy" (botón verde)
   - Espera confirmación: "Function deployed successfully"

---

### **OPCIÓN 2: Usando Supabase CLI (Recomendado para dev)**

#### **1. Instalar Supabase CLI**

**Windows (PowerShell como Admin):**
```powershell
npm install -g supabase
```

**Verificar instalación:**
```bash
supabase --version
```

#### **2. Login en Supabase**
```bash
supabase login
```
- Se abrirá tu navegador
- Autoriza el acceso

#### **3. Link al proyecto**
```bash
supabase link --project-ref pjryhnnvqqebmxrjxbko
```
- Te pedirá tu contraseña de la base de datos
- Usa la contraseña que configuraste en Supabase

#### **4. Deploy de la función**
```bash
supabase functions deploy reset-user-password
```

#### **5. Verificar el deploy**
Deberías ver un mensaje como:
```
Deployed Function reset-user-password on project pjryhnnvqqebmxrjxbko
Function URL: https://pjryhnnvqqebmxrjxbko.supabase.co/functions/v1/reset-user-password
```

---

## 🧪 PROBAR LA FUNCIÓN

### **Desde el navegador:**
1. Ve a tu app en: http://localhost:8080
2. Inicia sesión como admin
3. Ve a: **Control de Acceso** → **Gestión de Usuarios**
4. Click en el icono de llave 🔑 junto a un usuario
5. Genera una contraseña
6. Click en "Resetear Contraseña"
7. Deberías ver: ✅ "Contraseña Reseteada"

### **Desde Postman/Insomnia:**
```bash
POST https://pjryhnnvqqebmxrjxbko.supabase.co/functions/v1/reset-user-password

Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
  Content-Type: application/json

Body:
{
  "userEmail": "test@example.com",
  "newPassword": "nuevaPassword123"
}
```

---

## ❌ SOLUCIÓN DE ERRORES

### **Error: "Function not found"**
- La función no está desplegada
- Vuelve a hacer el deploy

### **Error: "Invalid JWT"**
- Tu token de sesión expiró
- Cierra sesión y vuelve a entrar

### **Error: "User not found"**
- El email no existe en el sistema
- Verifica que el email sea correcto

### **Error: "Could not invoke function"**
- Verifica que la función esté correctamente desplegada
- Revisa los logs en el Dashboard de Supabase

---

## 🔍 VER LOGS DE LA FUNCIÓN

1. Ve al Dashboard de Supabase
2. Click en "Edge Functions"
3. Click en "reset-user-password"
4. Ve a la pestaña "Logs"
5. Aquí verás todos los logs en tiempo real

---

## 📝 NOTAS IMPORTANTES

- ✅ La función usa el **Admin API** de Supabase (seguro)
- ✅ Solo usuarios autenticados pueden llamarla
- ✅ Registra auditoría de cambios (si existe la tabla `audit_logs`)
- ⚠️ No expone el `service_role_key` en el cliente
- ⚠️ Cada llamada verifica que el usuario tenga sesión activa

---

## 🆘 ¿NECESITAS AYUDA?

Si tienes problemas, revisa:
1. Que la función esté desplegada en Supabase
2. Que tu sesión de admin esté activa
3. Los logs de la función en el Dashboard
4. La consola del navegador (F12)

---

**¡Una vez desplegada, el sistema funcionará automáticamente!** 🎉
