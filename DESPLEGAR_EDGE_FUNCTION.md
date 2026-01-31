# 🚀 Desplegar Edge Function: create-user

## ⚠️ IMPORTANTE
Esta Edge Function es **NECESARIA** para crear usuarios desde el Super Admin sin cerrar tu sesión.

---

## 📋 Pasos para Desplegar

### 1️⃣ Instalar Supabase CLI (solo una vez)

**Windows (PowerShell como Administrador):**
```powershell
scoop install supabase
```

**O descarga directamente:**
https://github.com/supabase/cli/releases

---

### 2️⃣ Login en Supabase

```bash
supabase login
```

Esto abrirá tu navegador para autenticarte.

---

### 3️⃣ Link tu proyecto

```bash
supabase link --project-ref TU_PROJECT_ID
```

**¿Dónde encuentro el PROJECT_ID?**
- Ve a https://supabase.com/dashboard
- Abre tu proyecto
- En la URL verás: `https://supabase.com/dashboard/project/[PROJECT_ID]`
- Copia ese ID

---

### 4️⃣ Desplegar la función

```bash
supabase functions deploy create-user
```

✅ Listo! La función estará disponible en segundos.

---

## 🧪 Verificar que funciona

1. Ve al Super Admin
2. Intenta crear un nuevo usuario
3. Si todo está bien, se creará sin error

---

## ❓ Troubleshooting

### Error: "No project linked"
```bash
supabase link --project-ref TU_PROJECT_ID
```

### Error: "Not logged in"
```bash
supabase login
```

### Ver logs de la función
```bash
supabase functions logs create-user
```

---

## 📝 Comandos útiles

```bash
# Ver todas las funciones desplegadas
supabase functions list

# Ver logs en tiempo real
supabase functions logs create-user --tail

# Re-desplegar después de cambios
supabase functions deploy create-user
```

---

## 🆘 Si tienes problemas

Avísame y te ayudo con el deploy. La Edge Function es **esencial** para el funcionamiento del sistema.
