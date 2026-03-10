# 🃏 IMPLEMENTAR TARJETAS NFC EN ESTE SISTEMA

## ¿QUÉ ES ESTE SISTEMA?

Este es un **portal escolar** llamado "Lima Café 28" (puede tener otro nombre en tu versión). Es una aplicación web construida con:
- **React + TypeScript + Vite**
- **Tailwind CSS** para estilos
- **Supabase** como base de datos y autenticación
- **lucide-react** para íconos

El sistema tiene **dos partes principales**:
1. **Portal de Padres** (`src/pages/Index.tsx`) — Los padres ven el menú, hacen pedidos de almuerzo, recargan saldo
2. **Panel Administrativo** — Los admins y cajeros gestionan ventas, alumnos, etc.

---

## ¿QUÉ QUEREMOS HACER?

Integrar **lectores NFC USB** (que funcionan como teclado en Google Chrome) para que en el **Punto de Venta (kiosco escolar)**, cuando un alumno o profesor llega a comprar, solo tenga que pasar su tarjeta física por el lector y el sistema lo identifique automáticamente, sin que el cajero tenga que buscar el nombre manualmente.

**Hardware**: Lector NFC USB / USB-C (modo HID = actúa como teclado, no necesita driver especial)
**Navegador**: Google Chrome en Android y Windows

---

## ROLES DEL SISTEMA

```
superadmin       → Acceso total al sistema
admin_general    → Gestiona todas las sedes (NO tiene school_id en su perfil)
gestor_unidad    → Administra UNA sede (tiene school_id)
operador_caja    → Cajero del kiosco (tiene school_id)
parent           → Padre de familia
```

---

## TABLAS CLAVE DE LA BASE DE DATOS

```sql
students          → id, full_name, grade, section, balance, school_id, free_account, kiosk_disabled,
                    limit_type (none/daily/weekly/monthly), daily_limit, weekly_limit, monthly_limit
profiles          → id, full_name, role, school_id  (profesores y admins usan esta tabla)
schools           → id, name
transactions      → id, student_id, amount, type, status, metadata
nfc_cards         → (NUEVA - hay que crearla)
```

---

## ESTRUCTURA DE ARCHIVOS QUE TOCAREMOS

```
src/
  pages/
    POS.tsx              ← Punto de Venta (MODIFICAR: agregar lector NFC)
    SchoolAdmin.tsx      ← Panel de Administración de Sede (MODIFICAR: agregar pestaña)
  components/
    admin/
      NFCCardsManager.tsx  ← (CREAR NUEVO: gestión de tarjetas)
supabase/
  migrations/           ← Aquí ejecutamos los SQL en Supabase
```

---

## ARCHIVOS EXISTENTES QUE YA TIENES (NO MODIFICAR SU LÓGICA EXISTENTE)

- `src/pages/POS.tsx` ya tiene: búsqueda de alumnos por nombre (`studentSearch`), función `selectStudent()`, estados `clientMode`, `selectedStudent`, `selectedTeacher`
- `src/pages/SchoolAdmin.tsx` ya tiene: pestañas "Pedidos", "Grados y Salones", "Calendario" con estado `userSchoolId`

---

## ⚠️ ERRORES CONOCIDOS — LÉELOS ANTES DE EMPEZAR

Estos errores YA ocurrieron en el sistema original. Si los ignoras, los volverás a cometer.

### ❌ ERROR 1 — RLS bloquea a `admin_general` con error 403
**Cuándo pasa**: Si en la política RLS de la tabla `nfc_cards` pones `p.school_id = nfc_cards.school_id` para `admin_general`.
**Por qué pasa**: Los usuarios con rol `admin_general` tienen `school_id = NULL` en su perfil porque gestionan TODAS las sedes, no una sola.
**Solución**: La política de `admin_general` debe dar acceso total SIN restricción de `school_id`. Solo `gestor_unidad` se restringe por `school_id`.

### ❌ ERROR 2 — `get_nfc_holder` falla con "structure of query does not match function result type"
**Cuándo pasa**: Al llamar `supabase.rpc('get_nfc_holder', ...)` desde el POS.
**Por qué pasa**: Si declaras `student_balance NUMERIC` en el `RETURNS TABLE`, pero en la tabla `students` el campo `balance` es tipo `REAL` o `FLOAT4`, PostgreSQL rechaza la consulta.
**Solución**: Usar `FLOAT8` (no `NUMERIC`) en el `RETURNS TABLE` y agregar casts explícitos `s.balance::FLOAT8` en el SELECT.

### ❌ ERROR 3 — El UID del lector NFC se escribe en el campo de texto equivocado
**Cuándo pasa**: Si usas un `<input>` normal y esperas que el lector escriba en él.
**Por qué pasa**: El lector NFC actúa como teclado y escribe en cualquier `<input>` que tenga el foco. Si el usuario hace clic en otra parte, el foco cambia y el UID va al lugar equivocado.
**Solución**: Usar un **listener global** en `window` con `capture: true`. Medir el tiempo entre teclas: si llegan a < 80ms = es el lector NFC. Acumular en un `useRef` (buffer), NO en un estado de input. Procesar cuando llega `Enter` o cuando pasa 200ms sin más teclas.

### ❌ ERROR 4 — SQL falla si no se ejecuta en orden
**Cuándo pasa**: Si ejecutas el script de corrección RLS antes de que exista la tabla.
**Solución**: Ejecutar los 3 scripts en el ORDEN EXACTO indicado abajo.

---

## PASO 1 — EJECUTAR 3 SCRIPTS SQL EN SUPABASE

Ve a **Supabase > SQL Editor** y ejecuta estos scripts UNO POR UNO en este orden.

---

### 📄 SCRIPT SQL #1 — Crear tabla `nfc_cards`

```sql
-- Tabla para vincular tarjetas físicas NFC con alumnos o profesores
CREATE TABLE IF NOT EXISTS nfc_cards (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  card_uid      TEXT        UNIQUE NOT NULL,
  card_number   TEXT,
  holder_type   TEXT        CHECK (holder_type IN ('student', 'teacher')),
  student_id    UUID        REFERENCES students(id)  ON DELETE SET NULL,
  teacher_id    UUID        REFERENCES profiles(id)  ON DELETE SET NULL,
  school_id     UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  notes         TEXT,
  assigned_at   TIMESTAMPTZ,
  assigned_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_holder_consistency CHECK (
    (holder_type = 'student'  AND student_id IS NOT NULL AND teacher_id IS NULL) OR
    (holder_type = 'teacher'  AND teacher_id IS NOT NULL AND student_id IS NULL) OR
    (holder_type IS NULL      AND student_id IS NULL     AND teacher_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_nfc_cards_card_uid   ON nfc_cards(card_uid);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_student_id ON nfc_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_teacher_id ON nfc_cards(teacher_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_school_id  ON nfc_cards(school_id);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_is_active  ON nfc_cards(is_active);

CREATE OR REPLACE FUNCTION update_nfc_cards_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfc_cards_updated_at ON nfc_cards;
CREATE TRIGGER trg_nfc_cards_updated_at
  BEFORE UPDATE ON nfc_cards
  FOR EACH ROW EXECUTE FUNCTION update_nfc_cards_updated_at();

ALTER TABLE nfc_cards ENABLE ROW LEVEL SECURITY;

-- Políticas RLS iniciales (se reemplazan en el Script #2)
CREATE POLICY "nfc_superadmin_all" ON nfc_cards FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'));

CREATE POLICY "nfc_admin_manage" ON nfc_cards FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role IN ('admin_general', 'gestor_unidad') AND p.school_id = nfc_cards.school_id));

CREATE POLICY "nfc_cajero_read" ON nfc_cards FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role = 'operador_caja' AND p.school_id = nfc_cards.school_id));
```

---

### 📄 SCRIPT SQL #2 — Corregir RLS (OBLIGATORIO — sin esto admin_general da error 403)

```sql
-- FIX CRÍTICO: admin_general no tiene school_id en su perfil
-- La política anterior lo bloqueaba. Esta versión le da acceso total.
DROP POLICY IF EXISTS "nfc_superadmin_all" ON nfc_cards;
DROP POLICY IF EXISTS "nfc_admin_manage"   ON nfc_cards;
DROP POLICY IF EXISTS "nfc_cajero_read"    ON nfc_cards;

-- Superadmin: acceso total
CREATE POLICY "nfc_superadmin_all" ON nfc_cards FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'superadmin'));

-- Admin General: acceso total a TODAS las sedes (sin filtro school_id)
-- Gestor de Unidad: solo a SU sede
CREATE POLICY "nfc_admin_manage" ON nfc_cards FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND (
      p.role = 'admin_general'
      OR (p.role = 'gestor_unidad' AND p.school_id = nfc_cards.school_id)
    )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND (
      p.role = 'admin_general'
      OR (p.role = 'gestor_unidad' AND p.school_id = nfc_cards.school_id)
    )
  ));

-- Cajero: solo lectura de tarjetas de su sede (para buscar en el POS)
CREATE POLICY "nfc_cajero_read" ON nfc_cards FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role = 'operador_caja' AND p.school_id = nfc_cards.school_id
  ));
```

---

### 📄 SCRIPT SQL #3 — Crear función RPC `get_nfc_holder` (versión correcta con FLOAT8)

```sql
-- FIX CRÍTICO: usar FLOAT8 no NUMERIC, y casts explícitos
-- Sin esto el POS da "structure of query does not match function result type"
DROP FUNCTION IF EXISTS get_nfc_holder(TEXT);

CREATE OR REPLACE FUNCTION get_nfc_holder(p_card_uid TEXT)
RETURNS TABLE (
  holder_type            TEXT,
  student_id             UUID,
  student_name           TEXT,
  student_grade          TEXT,
  student_section        TEXT,
  student_balance        FLOAT8,
  student_free_account   BOOLEAN,
  student_kiosk_disabled BOOLEAN,
  student_limit_type     TEXT,
  student_daily_limit    FLOAT8,
  student_weekly_limit   FLOAT8,
  student_monthly_limit  FLOAT8,
  student_school_id      UUID,
  teacher_id             UUID,
  teacher_name           TEXT,
  card_number            TEXT,
  is_active              BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.holder_type::TEXT,
    nc.student_id,
    s.full_name::TEXT           AS student_name,
    s.grade::TEXT               AS student_grade,
    s.section::TEXT             AS student_section,
    s.balance::FLOAT8           AS student_balance,
    s.free_account::BOOLEAN     AS student_free_account,
    s.kiosk_disabled::BOOLEAN   AS student_kiosk_disabled,
    s.limit_type::TEXT          AS student_limit_type,
    s.daily_limit::FLOAT8       AS student_daily_limit,
    s.weekly_limit::FLOAT8      AS student_weekly_limit,
    s.monthly_limit::FLOAT8     AS student_monthly_limit,
    s.school_id                 AS student_school_id,
    nc.teacher_id,
    p.full_name::TEXT           AS teacher_name,
    nc.card_number::TEXT,
    nc.is_active
  FROM nfc_cards nc
  LEFT JOIN students  s ON s.id = nc.student_id
  LEFT JOIN profiles  p ON p.id = nc.teacher_id
  WHERE nc.card_uid = p_card_uid
  LIMIT 1;
END;
$$;
```

---

## PASO 2 — CREAR ARCHIVO `src/components/admin/NFCCardsManager.tsx`

Este es un componente React completamente nuevo. Créalo en esa ruta exacta.

**Qué hace este componente:**
- Muestra una lista de todas las tarjetas NFC registradas con nombre del titular
- Botón "Registrar Tarjeta" → abre un modal
- En el modal: el admin pasa la tarjeta por el lector → el sistema captura el UID automáticamente → el admin busca y asigna al alumno o profesor
- Permite editar y desactivar/activar tarjetas
- Si `schoolId` llega como prop con valor → filtra por esa sede (para gestor_unidad)
- Si `schoolId` es `null` → muestra todas las sedes con filtro (para superadmin/admin_general)

**Prop que recibe:**
```tsx
interface NFCCardsManagerProps {
  schoolId: string | null; // school_id del usuario logueado, o null si es superadmin
}
```

**Lógica CRÍTICA del listener NFC (copiar exactamente):**
```tsx
// Refs necesarios al inicio del componente:
const nfcBuffer = useRef('');
const nfcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const lastKeyTime = useRef<number>(0);
const [nfcListening, setNfcListening] = useState(false);
const [scannedUID, setScannedUID] = useState('');
const [scanWaiting, setScanWaiting] = useState(false); // true = esperando escaneo

// useEffect que activa el listener SOLO cuando el modal está abierto:
useEffect(() => {
  if (!showAssignModal) return;
  setNfcListening(true);
  nfcBuffer.current = '';

  const handleKey = (e: KeyboardEvent) => {
    if (!scanWaiting) return; // Solo capturar cuando esperamos un escaneo

    const now = Date.now();
    const timeSinceLast = now - lastKeyTime.current;
    lastKeyTime.current = now;

    if (e.key === 'Enter') {
      const uid = nfcBuffer.current.trim();
      nfcBuffer.current = '';
      if (nfcTimer.current) clearTimeout(nfcTimer.current);

      // UID válido solo si llegó rápido (el lector, no el usuario presionando Enter)
      if (uid.length >= 4 && timeSinceLast < 200) {
        setScannedUID(uid.toUpperCase());
        setScanWaiting(false);
        setNfcListening(false);
        toast({ title: '✅ Tarjeta detectada', description: `UID: ${uid.toUpperCase()}` });
      }
      return;
    }

    // Acumular solo si los chars llegan rápido (< 80ms = lector HID)
    if (e.key.length === 1) {
      if (timeSinceLast < 80 || nfcBuffer.current.length === 0) {
        nfcBuffer.current += e.key;
        if (nfcTimer.current) clearTimeout(nfcTimer.current);
        nfcTimer.current = setTimeout(() => { nfcBuffer.current = ''; }, 200);
      }
    }
  };

  window.addEventListener('keydown', handleKey, true); // capture=true es OBLIGATORIO
  return () => {
    window.removeEventListener('keydown', handleKey, true);
    setNfcListening(false);
    if (nfcTimer.current) clearTimeout(nfcTimer.current);
  };
}, [showAssignModal, scanWaiting]);
```

**Para buscar profesores**, usa la vista `teacher_profiles_with_schools` (no la tabla `profiles`):
```tsx
const { data } = await supabase
  .from('teacher_profiles_with_schools')
  .select('id, full_name, school_1_id, school_2_id')
  .ilike('full_name', `%${holderSearch}%`)
  .limit(8);
```

**Al guardar una tarjeta nueva** (`INSERT` en `nfc_cards`), el payload debe incluir:
```tsx
{
  card_uid: scannedUID.trim().toUpperCase(), // SIEMPRE en mayúsculas
  card_number: cardNumber.trim() || null,
  holder_type: holderType, // 'student' o 'teacher'
  student_id: holderType === 'student' ? selectedHolder.id : null,
  teacher_id: holderType === 'teacher' ? selectedHolder.id : null,
  school_id: modalSchoolId,  // UUID de la sede seleccionada
  is_active: true,
  assigned_at: new Date().toISOString(),
  assigned_by: user?.id ?? null,
}
```

---

## PASO 3 — MODIFICAR `src/pages/SchoolAdmin.tsx`

### Qué agregar:

**1. Importar el nuevo componente** (al inicio del archivo, junto a los otros imports):
```tsx
import { NFCCardsManager } from '@/components/admin/NFCCardsManager';
```

**2. `CreditCard` ya está importado** en este archivo de `lucide-react` — verificar que esté, si no agregarlo.

**3. Cambiar el grid de tabs de `grid-cols-3` a `grid-cols-4`**:
```tsx
// ANTES:
<TabsList className="grid w-full grid-cols-3 ...">
// DESPUÉS:
<TabsList className="grid w-full grid-cols-4 ...">
```

**4. Agregar el `TabsTrigger` para Tarjetas ID** (al final de la lista de triggers):
```tsx
<TabsTrigger value="cards" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
  <CreditCard className="h-4 w-4 mr-2" />
  Tarjetas ID
</TabsTrigger>
```

**5. Agregar el `TabsContent`** (al final, antes de cerrar el `</Tabs>`):
```tsx
<TabsContent value="cards" className="mt-6">
  <NFCCardsManager schoolId={userSchoolId} />
</TabsContent>
```

> `userSchoolId` es un estado que ya existe en `SchoolAdmin.tsx` — contiene el `school_id` del usuario logueado. Si el usuario es `admin_general`, puede ser `null`.

---

## PASO 4 — MODIFICAR `src/pages/POS.tsx`

El POS ya tiene la lógica de búsqueda manual de alumnos. Solo hay que AGREGAR la detección NFC. No elimines nada existente.

### 4.1 — Agregar refs y estados al inicio del componente `POS` (después de los `useRef` existentes)

Busca la línea donde está `const searchInputRef = useRef<HTMLInputElement>(null);` y agrega debajo:

```tsx
const nfcPosInputRef = useRef<HTMLInputElement>(null);
const [nfcScanning, setNfcScanning] = useState(false);
const [nfcError, setNfcError] = useState<string | null>(null);
const nfcPosBuffer = useRef('');
const nfcPosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const nfcPosLastKeyTime = useRef<number>(0);
```

### 4.2 — Agregar el `useEffect` para el listener global NFC

Agrégalo después del `useEffect` que carga los productos o alumnos (no importa el orden exacto, solo que esté dentro del componente):

```tsx
// ══════════════════════════════════════════════════════════
// 📡 NFC: listener global — activo solo cuando no hay cliente seleccionado
// (clientMode === null significa que se muestra la pantalla de selección)
// ══════════════════════════════════════════════════════════
useEffect(() => {
  if (clientMode) return; // Desactivar cuando ya hay un cliente seleccionado

  const handleNFCKey = (e: KeyboardEvent) => {
    const now = Date.now();
    const timeSinceLast = now - nfcPosLastKeyTime.current;
    nfcPosLastKeyTime.current = now;

    if (e.key === 'Enter') {
      const uid = nfcPosBuffer.current.trim();
      nfcPosBuffer.current = '';
      if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
      if (uid.length >= 4 && timeSinceLast < 200) {
        handleNFCScanPOS(uid);
      }
      return;
    }
    if (e.key.length === 1 && (timeSinceLast < 80 || nfcPosBuffer.current.length === 0)) {
      nfcPosBuffer.current += e.key;
      if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
      nfcPosTimer.current = setTimeout(() => { nfcPosBuffer.current = ''; }, 200);
    }
  };

  window.addEventListener('keydown', handleNFCKey, true);
  return () => {
    window.removeEventListener('keydown', handleNFCKey, true);
    if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
  };
}, [clientMode]);
```

### 4.3 — Agregar la función `handleNFCScanPOS`

Agrégala junto a las otras funciones del componente (antes del `return`):

```tsx
// ══════════════════════════════════════════════════════════
// 📡 NFC: procesar UID escaneado por el lector USB
// ══════════════════════════════════════════════════════════
const handleNFCScanPOS = async (uid: string) => {
  if (!uid.trim()) return;
  setNfcScanning(true);
  setNfcError(null);
  try {
    const { data, error } = await supabase
      .rpc('get_nfc_holder', { p_card_uid: uid.trim().toUpperCase() });

    if (error) throw error;

    if (!data || data.length === 0) {
      setNfcError('Tarjeta no registrada en el sistema');
      toast({
        variant: 'destructive',
        title: '❌ Tarjeta no encontrada',
        description: 'Esta tarjeta no está asignada a ningún alumno ni profesor.',
      });
      return;
    }

    const holder = data[0];

    if (!holder.is_active) {
      setNfcError('Esta tarjeta está desactivada');
      toast({
        variant: 'destructive',
        title: '🔴 Tarjeta inactiva',
        description: 'Contacta al administrador de sede.',
      });
      return;
    }

    if (holder.holder_type === 'student') {
      const student: Student = {
        id: holder.student_id,
        full_name: holder.student_name,
        photo_url: null,
        balance: holder.student_balance ?? 0,
        grade: holder.student_grade,
        section: holder.student_section,
        school_id: holder.student_school_id,
        free_account: holder.student_free_account,
        kiosk_disabled: holder.student_kiosk_disabled,
        limit_type: holder.student_limit_type as any,
        daily_limit: holder.student_daily_limit,
        weekly_limit: holder.student_weekly_limit,
        monthly_limit: holder.student_monthly_limit,
      };
      setClientMode('student');
      selectStudent(student); // función ya existente en POS.tsx
      const hasLim = (student.daily_limit && student.daily_limit > 0)
        || (student.weekly_limit && student.weekly_limit > 0)
        || (student.monthly_limit && student.monthly_limit > 0);
      const info = hasLim
        ? `${student.grade} - ${student.section} · Tope: S/ ${(student.daily_limit || student.weekly_limit || student.monthly_limit || 0).toFixed(2)}`
        : `${student.grade} - ${student.section} · Saldo: S/ ${student.balance.toFixed(2)}`;
      toast({ title: `👋 ¡Hola, ${student.full_name}!`, description: info });

    } else if (holder.holder_type === 'teacher') {
      setClientMode('teacher');
      // setSelectedTeacher y setTeacherSearch son estados ya existentes en POS.tsx
      setSelectedTeacher({ id: holder.teacher_id, full_name: holder.teacher_name });
      setTeacherSearch(holder.teacher_name);
      setShowTeacherResults(false);
      toast({ title: `👨‍🏫 Profesor identificado`, description: holder.teacher_name });
    }
  } catch (err: any) {
    setNfcError('Error al leer la tarjeta');
    toast({ variant: 'destructive', title: 'Error NFC', description: err.message });
  } finally {
    setNfcScanning(false);
  }
};
```

### 4.4 — Agregar el indicador visual NFC en la UI del POS

En el JSX del POS, busca la sección donde están los botones de tipo de cliente:
- El botón "🧑 Cliente Genérico" o similar
- El botón "🎓 Alumno" o "Estudiante"
- El botón "👨‍🏫 Profesores"

Agrega **debajo de esos botones** (antes de cerrar el div contenedor) este bloque:

```tsx
{/* ── Sección NFC ── */}
<div className="mt-4 pt-4 border-t border-gray-200">
  <div
    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${
      nfcScanning
        ? 'border-blue-400 bg-blue-50'
        : nfcError
        ? 'border-red-300 bg-red-50'
        : 'border-dashed border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
    }`}
    onClick={() => { setNfcError(null); }}
  >
    <div className={`h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 ${
      nfcScanning ? 'bg-blue-200' : nfcError ? 'bg-red-100' : 'bg-gray-200'
    }`}>
      {nfcScanning ? (
        <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
      ) : nfcError ? (
        <AlertCircle className="h-6 w-6 text-red-500" />
      ) : (
        <Smartphone className="h-6 w-6 text-gray-500" />
      )}
    </div>
    <div>
      <p className={`font-bold text-sm ${
        nfcScanning ? 'text-blue-700' : nfcError ? 'text-red-700' : 'text-gray-600'
      }`}>
        {nfcScanning ? 'Leyendo tarjeta...' : nfcError ? nfcError : '📡 Pasar tarjeta NFC'}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">
        {nfcScanning
          ? 'Acerca la tarjeta al lector'
          : 'Acerca la tarjeta al lector USB para identificar al alumno o profesor automáticamente'}
      </p>
    </div>
  </div>
</div>
```

> **Nota**: `Smartphone`, `Loader2`, y `AlertCircle` ya están importados en `POS.tsx` desde `lucide-react`. Si no están, agrégalos al import existente.

---

## PASO 5 — VERIFICACIÓN FINAL

Después de implementar todo, prueba estos casos:

| Caso | Resultado esperado |
|---|---|
| Admin abre "Sede > Tarjetas ID" | Ve el componente NFCCardsManager |
| Admin hace clic en "Registrar Tarjeta" | Se abre el modal con el lector esperando |
| Admin pasa una tarjeta por el lector | El modal muestra el UID en verde automáticamente |
| Admin intenta guardar sin seleccionar titular | Toast de error "Falta el titular" |
| Admin guarda correctamente | Tarjeta aparece en la lista |
| Cajero en POS pasa una tarjeta no registrada | Toast rojo "Tarjeta no encontrada" |
| Cajero en POS pasa tarjeta de alumno | Se selecciona al alumno automáticamente |
| Cajero en POS pasa tarjeta de profesor | Se selecciona al profesor automáticamente |
| Tarjeta desactivada | Toast "Tarjeta inactiva" |
| `admin_general` guarda tarjeta | NO debe dar error 403 |

---

## QUÉ SE IMPRIME EN LAS TARJETAS FÍSICAS

Cuando se manden a imprimir, deben llevar:
- ✅ **Número de tarjeta** (Ej: `001`, `042`) — para referencia visual del admin
- ✅ **Nombre del alumno o profesor**
- ✅ **Grado y sección** (si aplica)
- ❌ **NO imprimir el UID** — el UID es el código técnico interno del chip, no tiene utilidad para el usuario final

---

*Prompt generado desde el sistema de producción donde esta funcionalidad fue implementada y probada exitosamente, incluyendo todos los errores que se encontraron en el proceso.*
