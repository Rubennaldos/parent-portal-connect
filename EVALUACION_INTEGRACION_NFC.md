# 📋 Evaluación: Integración de NFC al Sistema POS

## 🎯 Objetivo
Permitir que los cajeros identifiquen estudiantes en el POS escaneando tarjetas NFC, en lugar de buscar por nombre.

---

## 🔍 Análisis del Sistema Actual

### ✅ Lo que ya tenemos:
1. **Tabla `students`** con:
   - `id` (UUID de Supabase) — identificador único
   - `full_name` — nombre completo
   - `school_id` — sede del estudiante
   - `balance`, `free_account`, `limit_type`, etc.

2. **Flujo actual del POS**:
   - Cajero busca por nombre (`searchStudents` con `ilike`)
   - Selecciona de lista de resultados
   - Usa `selectedStudent.id` para todas las operaciones

### ❌ Lo que NO tenemos:
- Campo en `students` para guardar el código NFC
- Tabla de mapeo tarjeta → estudiante
- API del navegador para leer NFC
- UI para asignar tarjetas a estudiantes

---

## 🚨 Problema Principal

**Los códigos NFC de las tarjetas físicas NO son los UUIDs de Supabase.**

- **UUID de Supabase**: `cd5fb741-72fd-445d-9f16-1a11ba92ca88` (36 caracteres)
- **Código NFC típico**: `04:12:34:56:78:90:AB` (formato hexadecimal)

**Solución**: Necesitamos una **tabla de mapeo** que relacione el código NFC con el `student_id`.

---

## 📊 Opciones de Implementación

### **Opción 1: Tabla de Mapeo (RECOMENDADA) ✅**

**Estructura:**
```sql
CREATE TABLE nfc_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nfc_id TEXT UNIQUE NOT NULL,  -- Código único de la tarjeta física
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  school_id UUID REFERENCES schools(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Ventajas:**
- ✅ Una tarjeta puede reasignarse a otro estudiante
- ✅ Historial de asignaciones (si guardamos `assigned_at`, `assigned_by`)
- ✅ Múltiples tarjetas por estudiante (si es necesario)
- ✅ Desactivar tarjetas perdidas sin borrar datos

**Desventajas:**
- ⚠️ Requiere tabla adicional
- ⚠️ Necesita UI para asignar tarjetas

---

### **Opción 2: Campo Directo en `students`**

**Estructura:**
```sql
ALTER TABLE students ADD COLUMN nfc_id TEXT UNIQUE;
```

**Ventajas:**
- ✅ Más simple (una sola tabla)
- ✅ Búsqueda directa: `SELECT * FROM students WHERE nfc_id = '04:12:34:56'`

**Desventajas:**
- ❌ No permite reasignar tarjetas fácilmente
- ❌ No hay historial de asignaciones
- ❌ Si un estudiante cambia de tarjeta, hay que actualizar manualmente

---

## 🛠️ Plan de Integración (Opción 1 - Recomendada)

### **FASE 1: Base de Datos**

#### 1.1 Crear tabla `nfc_cards`
```sql
CREATE TABLE nfc_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nfc_id TEXT UNIQUE NOT NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  school_id UUID REFERENCES schools(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nfc_cards_nfc_id ON nfc_cards(nfc_id);
CREATE INDEX idx_nfc_cards_student_id ON nfc_cards(student_id);
CREATE INDEX idx_nfc_cards_school_id ON nfc_cards(school_id);
```

#### 1.2 RLS (Row Level Security)
```sql
-- Admins pueden ver todas las tarjetas de su sede
CREATE POLICY "admins_read_nfc_cards" ON nfc_cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin_general' OR p.role = 'superadmin')
      AND (p.school_id = nfc_cards.school_id OR p.role = 'superadmin')
    )
  );

-- Solo admins pueden asignar/desasignar tarjetas
CREATE POLICY "admins_manage_nfc_cards" ON nfc_cards
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin_general' OR p.role = 'superadmin')
    )
  );
```

---

### **FASE 2: API del Navegador (Web NFC)**

#### 2.1 Compatibilidad
- ✅ **Chrome/Edge 89+** (Android)
- ✅ **Samsung Internet** (Android)
- ❌ **Safari iOS** (NO soporta Web NFC)
- ❌ **Firefox** (NO soporta Web NFC)

**Limitación**: Solo funciona en **Android** con Chrome/Edge.

#### 2.2 Código de lectura NFC
```typescript
// src/lib/nfcReader.ts
export async function readNFC(): Promise<string | null> {
  if (!('NDEFReader' in window)) {
    throw new Error('NFC no soportado en este navegador');
  }

  const reader = new (window as any).NDEFReader();
  
  try {
    await reader.scan();
    
    return new Promise((resolve, reject) => {
      reader.addEventListener('reading', (event: any) => {
        const nfcId = event.serialNumber || event.message?.records?.[0]?.data;
        resolve(nfcId);
      });
      
      reader.addEventListener('error', (error: any) => {
        reject(error);
      });
    });
  } catch (err) {
    throw err;
  }
}
```

---

### **FASE 3: UI de Asignación de Tarjetas**

#### 3.1 Módulo en Super Admin / Admin General

**Ubicación**: `src/components/admin/NFCManagement.tsx`

**Funcionalidades:**
1. **Listar tarjetas asignadas**:
   - Tabla con: NFC ID, Estudiante, Sede, Fecha asignación
   - Filtro por sede
   - Búsqueda por nombre de estudiante

2. **Asignar nueva tarjeta**:
   - Botón "Escanear Tarjeta NFC"
   - Leer código NFC
   - Buscar estudiante (por nombre o código)
   - Guardar asignación

3. **Reasignar tarjeta**:
   - Botón "Cambiar Estudiante"
   - Seleccionar nuevo estudiante
   - Actualizar `student_id` y `assigned_at`

4. **Desactivar tarjeta**:
   - Botón "Desactivar" (si se pierde)
   - Marcar `is_active = false`

---

### **FASE 4: Integración en el POS**

#### 4.1 Modificar `POS.tsx`

**Agregar botón "Escanear NFC"** en el modal de búsqueda de estudiantes:

```typescript
// Estado para NFC
const [nfcReading, setNfcReading] = useState(false);

// Función para leer NFC y buscar estudiante
const handleNFCScan = async () => {
  setNfcReading(true);
  try {
    const nfcId = await readNFC();
    
    // Buscar estudiante por NFC ID
    const { data: nfcCard, error } = await supabase
      .from('nfc_cards')
      .select('student_id, students(*)')
      .eq('nfc_id', nfcId)
      .eq('is_active', true)
      .single();
    
    if (error || !nfcCard) {
      toast({
        variant: 'destructive',
        title: 'Tarjeta no encontrada',
        description: 'Esta tarjeta no está asignada a ningún estudiante',
      });
      return;
    }
    
    // Seleccionar estudiante automáticamente
    const student = nfcCard.students;
    selectStudent(student);
    
    toast({
      title: '✅ Estudiante encontrado',
      description: student.full_name,
    });
  } catch (err: any) {
    toast({
      variant: 'destructive',
      title: 'Error al leer NFC',
      description: err.message,
    });
  } finally {
    setNfcReading(false);
  }
};
```

**UI en el modal de búsqueda:**
```tsx
<Button
  onClick={handleNFCScan}
  disabled={nfcReading}
  className="w-full h-12 bg-blue-600 hover:bg-blue-700"
>
  {nfcReading ? (
    <>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      Acerca la tarjeta...
    </>
  ) : (
    <>
      <QrCode className="h-4 w-4 mr-2" />
      Escanear Tarjeta NFC
    </>
  )}
</Button>
```

---

## 📝 Flujo Completo de Uso

### **Para el Admin (Asignar Tarjetas):**
1. Ir a "Gestión de Tarjetas NFC" (Super Admin)
2. Click en "Asignar Nueva Tarjeta"
3. Click en "Escanear Tarjeta"
4. Acercar tarjeta física al dispositivo
5. Sistema lee código NFC (ej: `04:12:34:56:78:90:AB`)
6. Buscar estudiante por nombre
7. Click "Asignar"
8. Sistema guarda: `nfc_id` → `student_id`

### **Para el Cajero (Usar en POS):**
1. Abrir POS
2. Click "Buscar Estudiante"
3. Click "Escanear Tarjeta NFC"
4. Acercar tarjeta del estudiante
5. Sistema busca automáticamente y selecciona al estudiante
6. Continuar con la venta normal

---

## ⚠️ Consideraciones Importantes

### 1. **Compatibilidad de Navegadores**
- ✅ **Funciona**: Chrome/Edge en Android
- ❌ **NO funciona**: iOS Safari, Firefox, Desktop

**Solución**: Mostrar mensaje si el navegador no soporta NFC:
```typescript
if (!('NDEFReader' in window)) {
  toast({
    variant: 'destructive',
    title: 'NFC no disponible',
    description: 'Esta función solo funciona en Android con Chrome/Edge',
  });
  return;
}
```

### 2. **Formato del Código NFC**
Los códigos NFC pueden venir en diferentes formatos:
- `04:12:34:56:78:90:AB` (hexadecimal con `:`)
- `041234567890AB` (hexadecimal sin separadores)
- `1234567890AB` (solo números)

**Solución**: Normalizar al leer:
```typescript
function normalizeNFCId(raw: string): string {
  // Eliminar espacios, convertir a mayúsculas
  return raw.replace(/[\s:-]/g, '').toUpperCase();
}
```

### 3. **Tarjetas Perdidas o Robadas**
- Marcar `is_active = false` en lugar de borrar
- Permitir reasignar la misma tarjeta a otro estudiante
- Historial de asignaciones (opcional, agregar tabla `nfc_card_history`)

### 4. **Múltiples Tarjetas por Estudiante**
Si un estudiante tiene 2 tarjetas (ej: una en casa, una en el colegio):
- Permitir múltiples registros con mismo `student_id`
- Al escanear cualquiera, seleccionar al mismo estudiante

---

## 🎯 Resumen de Requisitos

### **Base de Datos:**
- [ ] Tabla `nfc_cards` con campos: `nfc_id`, `student_id`, `school_id`, `is_active`
- [ ] Índices para búsqueda rápida
- [ ] RLS policies para admins

### **Backend:**
- [ ] Función helper `readNFC()` usando Web NFC API
- [ ] Función `normalizeNFCId()` para estandarizar códigos

### **Frontend:**
- [ ] Componente `NFCManagement.tsx` (Super Admin)
- [ ] Botón "Escanear NFC" en `POS.tsx`
- [ ] Manejo de errores (navegador no compatible, tarjeta no encontrada)

### **Testing:**
- [ ] Probar en Android con Chrome
- [ ] Probar asignación de tarjetas
- [ ] Probar lectura en POS
- [ ] Probar reasignación de tarjetas

---

## 💰 Costo Estimado de Implementación

- **Desarrollo**: ~4-6 horas
  - Tabla BD + RLS: 30 min
  - UI de asignación: 2 horas
  - Integración en POS: 1.5 horas
  - Testing y ajustes: 1 hora

- **Hardware**: 
  - Tarjetas NFC: ~$0.50 - $2.00 c/u (depende del tipo)
  - No requiere hardware adicional (usa el teléfono/tablet)

---

## ✅ Conclusión

**La integración de NFC es FACTIBLE** con las siguientes condiciones:

1. ✅ Usar tabla de mapeo (`nfc_cards`) en lugar de campo directo
2. ✅ Solo funciona en Android con Chrome/Edge (limitación del navegador)
3. ✅ Requiere UI de asignación para admins
4. ✅ Integración simple en el POS (botón + lectura automática)

**Recomendación**: Implementar en 2 fases:
- **Fase 1**: Base de datos + UI de asignación (admins)
- **Fase 2**: Integración en POS (cajeros)

¿Procedemos con la implementación?
