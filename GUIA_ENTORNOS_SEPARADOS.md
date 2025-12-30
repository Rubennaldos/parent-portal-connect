# 🏗️ GUÍA: Entornos de Desarrollo vs Producción

## ¿Por qué necesitas esto?

Cuando trabajas en un sistema real, **NUNCA trabajas directamente en la versión que usan los clientes**. Necesitas:

1. **Desarrollo**: Donde TÚ trabajas y rompes cosas
2. **Producción**: Donde el CLIENTE prueba, siempre funcional

---

## 🚀 SOLUCIÓN RÁPIDA: Dos Proyectos en Supabase

### Paso 1: Crear Proyecto de Desarrollo

1. Ve a [supabase.com](https://supabase.com)
2. Crea un nuevo proyecto: `parent-portal-DEV`
3. Copia la URL y Anon Key

### Paso 2: Clonar la Base de Datos de Producción

En el proyecto de **PRODUCCIÓN** (actual):
- Ve a SQL Editor
- Ejecuta este comando para exportar la estructura:

```sql
-- Esto genera el SQL completo de tu base de datos
SELECT 
    'CREATE TABLE ' || table_name || ' (...);'
FROM information_schema.tables
WHERE table_schema = 'public';
```

Luego ejecuta todos esos scripts en el proyecto **DEV**.

### Paso 3: Configurar el Código para Múltiples Entornos

Actualiza `src/config/supabase.config.ts`:

```typescript
// src/config/supabase.config.ts

// Detectar si estamos en desarrollo o producción
const isDevelopment = 
  window.location.hostname === 'localhost' || 
  window.location.hostname.includes('dev');

// Configuración de DESARROLLO (para ti)
const DEV_CONFIG = {
  URL: "https://tu-proyecto-dev.supabase.co",
  ANON_KEY: "tu_anon_key_dev"
};

// Configuración de PRODUCCIÓN (para el cliente)
const PROD_CONFIG = {
  URL: "https://duxqzozoahvrvqseinji.supabase.co",
  ANON_KEY: "sb_publishable_1IjZsZ2X-_fay6oFVUc2Qg_gzCZRFNU"
};

// Exportar la configuración correcta
export const SUPABASE_CONFIG = isDevelopment ? DEV_CONFIG : PROD_CONFIG;

// Mostrar en consola qué entorno estás usando
console.log(`🔧 Entorno: ${isDevelopment ? 'DESARROLLO' : 'PRODUCCIÓN'}`);
```

### Paso 4: Workflow de Trabajo

```
TÚ TRABAJAS:
├─ localhost:5173 (DEV)
│  └─ Supabase DEV
│     └─ Haces cambios, pruebas, rompes todo
│
CLIENTE PRUEBA:
└─ miapp.lovable.app (PROD)
   └─ Supabase PROD
      └─ Solo código estable y funcional
```

---

## 🎯 ALTERNATIVA MÁS SIMPLE: Usar Flags de Características

Si no quieres dos bases de datos, puedes usar "feature flags":

```typescript
// src/config/features.ts
export const FEATURES = {
  // Activa/desactiva funcionalidades en desarrollo
  SHOW_DEBUG_PANEL: window.location.hostname === 'localhost',
  ENABLE_ONBOARDING: true,
  ENABLE_POS: false, // Desactivado hasta que esté listo
  ENABLE_COBRANZAS: false,
};

// En tu código:
{FEATURES.ENABLE_POS && (
  <Button onClick={() => navigate('/pos')}>
    Ir a POS
  </Button>
)}
```

---

## 📦 Workflow con Git (Profesional)

```bash
# 1. Crear rama de desarrollo
git checkout -b development

# 2. Trabajar en development
git add .
git commit -m "feat: nueva funcionalidad"
git push origin development

# 3. Cuando todo esté probado, hacer merge a main
git checkout main
git merge development
git push origin main  # Esto se despliega a producción
```

---

## 🔄 Ciclo de Deploy Profesional

```
1. DESARROLLO (localhost)
   ↓ (Pruebas locales OK)
   
2. STAGING (miapp-staging.lovable.app)
   ↓ (Cliente aprueba)
   
3. PRODUCCIÓN (miapp.lovable.app)
   ✅ (Usuarios finales)
```

---

## ⚡ RECOMENDACIÓN PARA TU CASO

**Opción más práctica ahora:**

1. **Crear un segundo proyecto en Supabase** (5 minutos)
   - Nombre: `parent-portal-DEV`
   - Ejecutar tus scripts SQL ahí

2. **Modificar `supabase.config.ts`** como mostré arriba

3. **Darle al cliente el link de producción:**
   - URL: `https://tu-app.lovable.app`
   - Siempre funcional

4. **Tú trabajas en:**
   - URL: `http://localhost:5173`
   - Base de datos DEV
   - Puedes romper todo sin problema

5. **Cuando termines una funcionalidad:**
   ```bash
   # Probar localmente
   npm run dev
   
   # Si todo OK, hacer deploy
   git add .
   git commit -m "feat: onboarding completo"
   git push origin main
   ```

---

## 🎓 Aprende Más

- [Video: Entornos de Desarrollo](https://www.youtube.com/watch?v=ejemplo)
- [Guía: Git Flow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow)
- [Supabase: Múltiples Entornos](https://supabase.com/docs/guides/platform/multi-environment)

---

## 🚨 ERRORES COMUNES

❌ **NO HAGAS ESTO:**
- Trabajar directamente en producción
- Darle al cliente la URL de desarrollo
- Hacer cambios sin probar primero

✅ **SÍ HAGAS ESTO:**
- Siempre prueba en DEV primero
- Solo haz deploy cuando todo funcione
- Usa Git para versionado

---

¿Dudas? Pregúntame específicamente qué quieres implementar.


