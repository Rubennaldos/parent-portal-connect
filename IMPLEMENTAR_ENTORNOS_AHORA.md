# ⚡ IMPLEMENTAR ENTORNOS AHORA (15 MINUTOS)

## 🎯 Lo que vamos a hacer:

1. Crear un segundo proyecto de Supabase (DEV)
2. Modificar tu código para usar 2 entornos
3. Darle al cliente solo el link de PRODUCCIÓN

---

## 📋 CHECKLIST PASO A PASO

### ✅ PASO 1: Crear Proyecto de Desarrollo en Supabase

1. Ve a [supabase.com](https://supabase.com/dashboard)
2. Click en **"New Project"**
3. Configuración:
   - Name: `parent-portal-DEV`
   - Database Password: (guarda esto)
   - Region: (el mismo que producción)
4. **Espera 2 minutos** mientras se crea
5. Copia estas credenciales:
   ```
   URL DEV: https://__________.supabase.co
   ANON KEY DEV: eyJhb________
   ```

---

### ✅ PASO 2: Clonar la Base de Datos a DEV

**En el proyecto de PRODUCCIÓN**, ve a SQL Editor y ejecuta:

```sql
-- Ver todas tus tablas
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
```

Luego, en tu proyecto **DEV**, ejecuta estos scripts en orden:

1. `SISTEMA_REGISTRO_PADRES_DB.sql` (completo)
2. `FIX_REGISTRO_ERRORS.sql` (completo)
3. `FIX_COLUMN_NAME_ERROR.sql` (si lo tienes)

---

### ✅ PASO 3: Actualizar el Código

**Reemplaza** `src/config/supabase.config.ts` con esto:

```typescript
// src/config/supabase.config.ts

// 🔍 Detectar entorno automáticamente
const isLocalhost = window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1';

const isDevelopment = isLocalhost || 
                     window.location.hostname.includes('dev') ||
                     window.location.hostname.includes('staging');

// 🟢 DESARROLLO (para ti)
const DEV_CONFIG = {
  URL: "PEGA_AQUI_URL_DEV",
  ANON_KEY: "PEGA_AQUI_KEY_DEV",
};

// 🔴 PRODUCCIÓN (para el cliente)
const PROD_CONFIG = {
  URL: "https://duxqzozoahvrvqseinji.supabase.co",
  ANON_KEY: "sb_publishable_1IjZsZ2X-_fay6oFVUc2Qg_gzCZRFNU",
};

// Seleccionar configuración
export const SUPABASE_CONFIG = isDevelopment ? DEV_CONFIG : PROD_CONFIG;

// Debug en consola
if (isDevelopment) {
  console.log('🔧 ENTORNO: DESARROLLO');
  console.log('📦 Base de datos DEV activa');
} else {
  console.log('🚀 ENTORNO: PRODUCCIÓN');
  console.log('📦 Base de datos PROD activa');
}
```

---

### ✅ PASO 4: Probar el Sistema

**En tu computadora (localhost):**
```bash
npm run dev
```
- Debería conectar a Supabase DEV ✅
- Verás "🔧 ENTORNO: DESARROLLO" en la consola

**En producción (Lovable):**
- URL: `https://tu-app.lovable.app`
- Debería conectar a Supabase PROD ✅
- Verás "🚀 ENTORNO: PRODUCCIÓN" en la consola

---

### ✅ PASO 5: Workflow de Trabajo Diario

```bash
# 1️⃣ Trabajar localmente (conecta a DEV)
npm run dev

# 2️⃣ Hacer cambios y probar
# (Puedes romper todo, es tu base de datos DEV)

# 3️⃣ Cuando todo funcione bien, hacer deploy
git add .
git commit -m "feat: nueva funcionalidad"
git push origin main

# 4️⃣ Lovable hace deploy automático a PROD
# (El cliente ve los cambios en 2 minutos)
```

---

## 🎯 RESULTADO FINAL

Después de implementar esto:

| Entorno | URL | Base de Datos | ¿Quién la usa? |
|---------|-----|---------------|----------------|
| **DESARROLLO** | `localhost:5173` | Supabase DEV | TÚ (programador) |
| **PRODUCCIÓN** | `miapp.lovable.app` | Supabase PROD | CLIENTE (dueño) |

---

## 🚨 IMPORTANTE: Sincronización

**¿Qué pasa si cambias la estructura de la DB en DEV?**

Cuando hagas cambios estructurales (nuevas tablas, columnas, etc.), debes:

1. Probar en DEV primero
2. Guardar el script SQL
3. Ejecutarlo en PROD antes de hacer deploy

**Ejemplo:**

```sql
-- cambios_estructurales.sql
ALTER TABLE students ADD COLUMN photo_url TEXT;
```

```bash
# 1. Ejecutar en Supabase DEV (probar)
# 2. Ejecutar en Supabase PROD (aplicar)
# 3. Hacer git push (deploy del código)
```

---

## 📊 Ventajas de Este Sistema

✅ **Puedes trabajar sin miedo** a romper el sistema del cliente
✅ **El cliente puede probar** cuando quiera sin interferir contigo
✅ **Datos de prueba separados** de datos reales
✅ **Deploy controlado** solo cuando tú decidas
✅ **Profesional** como empresas grandes (Spotify, Netflix, etc.)

---

## 🆘 ¿Necesitas Ayuda?

Si tienes problemas con algún paso, dime en cuál te trabaste:
- ❓ "No sé cómo crear proyecto en Supabase"
- ❓ "No sé qué scripts ejecutar en DEV"
- ❓ "El código no detecta el entorno correcto"

---

## 🎓 Bonus: Variables de Entorno Avanzadas

Si quieres algo más profesional, usa `.env`:

```bash
# .env.local (para desarrollo local)
VITE_SUPABASE_URL=https://proyecto-dev.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...

# .env.production (para Lovable)
VITE_SUPABASE_URL=https://duxqzozoahvrvqseinji.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_1IjZsZ2X...
```

Pero la solución que te di arriba funciona sin configurar nada extra.

---

**¿Empezamos? Dime si quieres que te ayude con algún paso específico.**


