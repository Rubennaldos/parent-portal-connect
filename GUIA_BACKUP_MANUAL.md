# 📦 GUÍA: Backup Manual de Supabase (Plan Gratuito)

## 🚨 PROBLEMA

El **plan gratuito de Supabase NO incluye backups automáticos**.

Necesitas hacer un backup manual antes de entregar el sistema al cliente.

---

## ✅ SOLUCIÓN RÁPIDA (5 MINUTOS)

### MÉTODO 1: Exportar Estructura Completa (Recomendado)

#### Paso 1: Ir a SQL Editor

1. Abre Supabase: https://supabase.com/dashboard/project/duxqzozoahvrvqseinji
2. Click en **SQL Editor** (menú izquierdo)
3. Click en **"New query"**

---

#### Paso 2: Exportar Datos de Usuarios

Pega este código y ejecuta:

```sql
-- Exportar perfiles de usuario
SELECT id, email, role, created_at 
FROM public.profiles 
ORDER BY created_at DESC;
```

**Después de ejecutar:**
1. Click en **"Download CSV"** (abajo de los resultados)
2. Guarda como: `backup_profiles.csv`

---

#### Paso 3: Exportar Datos de Padres

```sql
-- Exportar perfiles de padres
SELECT 
  pp.user_id,
  pp.full_name,
  pp.dni,
  pp.phone_1,
  pp.phone_2,
  pp.address,
  pp.school_id,
  pp.onboarding_completed,
  pp.created_at
FROM public.parent_profiles pp
ORDER BY pp.created_at DESC;
```

**Guardar como:** `backup_parent_profiles.csv`

---

#### Paso 4: Exportar Datos de Estudiantes

```sql
-- Exportar estudiantes
SELECT 
  id,
  parent_id,
  school_id,
  full_name,
  grade,
  section,
  balance,
  daily_limit,
  is_active,
  created_at
FROM public.students
ORDER BY created_at DESC;
```

**Guardar como:** `backup_students.csv`

---

#### Paso 5: Exportar Productos

```sql
-- Exportar productos
SELECT 
  id, 
  name, 
  category, 
  price, 
  stock, 
  is_active,
  created_at
FROM public.products
ORDER BY category, name;
```

**Guardar como:** `backup_products.csv`

---

#### Paso 6: Exportar Transacciones

```sql
-- Exportar transacciones
SELECT 
  id,
  student_id,
  transaction_type,
  amount,
  balance_before,
  balance_after,
  created_at
FROM public.transactions
ORDER BY created_at DESC
LIMIT 1000;
```

**Guardar como:** `backup_transactions.csv`

---

#### Paso 7: Exportar Colegios

```sql
-- Exportar colegios
SELECT id, name, code, address, is_active, created_at
FROM public.schools
ORDER BY name;
```

**Guardar como:** `backup_schools.csv`

---

### MÉTODO 2: Backup Completo con pg_dump (Avanzado)

Si tienes instalado PostgreSQL en tu computadora:

```bash
# Obtener la connection string de Supabase:
# Settings → Database → Connection string (Direct connection)

pg_dump "postgresql://postgres:[PASSWORD]@db.duxqzozoahvrvqseinji.supabase.co:5432/postgres" > backup_completo.sql
```

**Ventajas:**
- ✅ Backup completo (estructura + datos)
- ✅ Fácil de restaurar
- ✅ Incluye todo (triggers, functions, etc.)

**Desventajas:**
- ❌ Requiere instalar PostgreSQL
- ❌ Más técnico

---

## 📁 ORGANIZAR TUS BACKUPS

Crea una carpeta en tu computadora:

```
C:\Users\Alberto Naldos\Desktop\miproyecto\backups\
└── 2024-12-30_antes_entrega_cliente\
    ├── backup_profiles.csv
    ├── backup_parent_profiles.csv
    ├── backup_students.csv
    ├── backup_products.csv
    ├── backup_transactions.csv
    ├── backup_schools.csv
    └── README.txt (con notas de qué contiene)
```

---

## 🔄 CÓMO RESTAURAR EL BACKUP

Si algo sale mal, puedes restaurar así:

### Desde CSV:

1. Ve a Supabase → SQL Editor
2. Trunca la tabla:
   ```sql
   TRUNCATE public.students CASCADE;
   ```
3. Ve a Table Editor
4. Click en **"Import data"**
5. Sube tu archivo CSV
6. Mapea las columnas
7. Click **"Import"**

### Desde SQL (pg_dump):

```bash
psql "tu_connection_string" < backup_completo.sql
```

---

## ⏱️ CUÁNDO HACER BACKUPS

### Ahora (Antes de entregar):
✅ Hacer backup manual antes de dar el link al cliente

### Semanalmente (Mientras trabajas):
✅ Cada viernes antes de terminar la semana

### Antes de cambios grandes:
✅ Antes de cambiar estructura de base de datos
✅ Antes de ejecutar scripts de migración
✅ Antes de actualizar RLS policies

---

## 🎯 ALTERNATIVA: Subir a PRO (Opcional)

**Costo:** $25/mes
**Incluye:**
- ✅ Backups automáticos diarios (7 días)
- ✅ Point-in-time recovery
- ✅ Más espacio de almacenamiento
- ✅ Mejor soporte

**¿Vale la pena?**
- ✅ Sí, si el cliente te paga mensualidad
- ❌ No, si es un proyecto de una sola vez

**Link para upgrade:**
https://supabase.com/dashboard/project/duxqzozoahvrvqseinji/settings/billing

---

## 📝 CHECKLIST DE BACKUP

Antes de entregar al cliente, marca:

- [ ] ✅ Exporté `backup_profiles.csv`
- [ ] ✅ Exporté `backup_parent_profiles.csv`
- [ ] ✅ Exporté `backup_students.csv`
- [ ] ✅ Exporté `backup_products.csv`
- [ ] ✅ Exporté `backup_transactions.csv`
- [ ] ✅ Exporté `backup_schools.csv`
- [ ] ✅ Guardé todo en carpeta organizada
- [ ] ✅ Agregué README.txt con notas
- [ ] ✅ Hice copia en Google Drive/OneDrive (opcional)

---

## 🆘 SI PIERDES DATOS

**No entres en pánico.** Supabase mantiene logs por 7 días (incluso en plan free).

1. Contacta a soporte de Supabase: https://supabase.com/dashboard/support
2. Explica qué pasó
3. Te pueden ayudar a recuperar datos recientes

---

## 💡 RECOMENDACIÓN PROFESIONAL

**Para este proyecto:**

1. **Ahora:** Haz backup manual (CSV) - 5 minutos
2. **Entrega al cliente:** Con los backups guardados
3. **Después:** Si el proyecto crece, considera subir a PRO

**Razón:** El plan gratuito es suficiente para empezar, y puedes hacer backups manuales semanalmente.

---

## ✅ RESUMEN RÁPIDO

```
PASO 1: SQL Editor → New query
PASO 2: Pega query de profiles → Download CSV
PASO 3: Pega query de parent_profiles → Download CSV
PASO 4: Pega query de students → Download CSV
PASO 5: Pega query de products → Download CSV
PASO 6: Pega query de transactions → Download CSV
PASO 7: Pega query de schools → Download CSV
PASO 8: Guarda todo en carpeta "backup-2024-12-30"
PASO 9: ✅ Listo. Puedes entregar al cliente con confianza
```

---

**¿Quieres que te guíe paso a paso para hacer el backup ahora?** 🚀

Solo dime "empecemos con el backup" y te voy dando cada query una por una.


