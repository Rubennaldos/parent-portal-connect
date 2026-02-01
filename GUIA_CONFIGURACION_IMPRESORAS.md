# 📋 GUÍA: Configuración de Impresoras por Sede

## 🎯 Descripción General

Se ha implementado un módulo completo de **Configuración de Impresoras** en el panel de SuperAdmin que permite:

- ✅ Configurar impresoras para cada sede
- ✅ Subir logos personalizados por sede
- ✅ Personalizar formato de tickets (encabezado, pie de página, tamaño)
- ✅ Configurar información del negocio (RUC, dirección, teléfono)
- ✅ Vista previa en tiempo real del ticket
- ✅ Opciones de QR, código de barras, impresión automática

---

## 📦 Archivos Creados/Modificados

### Nuevos Archivos:
1. **`supabase/migrations/CREATE_PRINTER_CONFIGS.sql`**
   - Crea la tabla `printer_configs` con todos los campos necesarios
   - Configura RLS (políticas de seguridad)
   - Inserta configuraciones por defecto para cada sede existente

2. **`supabase/migrations/SETUP_STORAGE_BUCKET.sql`**
   - Instrucciones para crear el bucket `school-assets` en Supabase Storage
   - Políticas de acceso para upload de logos

3. **`src/components/admin/PrinterConfiguration.tsx`**
   - Componente React completo con tabs:
     - **General**: Nombre impresora, datos del negocio, RUC, dirección
     - **Logo**: Upload de logos con preview y dimensiones ajustables
     - **Formato Ticket**: Encabezado, pie, tamaño fuente, copias, QR/barcode
     - **Vista Previa**: Simulación visual del ticket en tiempo real

### Archivos Modificados:
4. **`src/pages/SuperAdmin.tsx`**
   - Se agregó nueva pestaña "Impresoras" con icono de `Printer`
   - Importación del componente `PrinterConfiguration`

---

## 🚀 PASOS PARA ACTIVAR LA FUNCIONALIDAD

### **PASO 1: Ejecutar SQL para crear tabla**

1. Ve a **Supabase Dashboard** > **SQL Editor**
2. Abre el archivo: `supabase/migrations/CREATE_PRINTER_CONFIGS.sql`
3. Copia todo el contenido y pégalo en el SQL Editor
4. Click en **"Run"**
5. Verifica que aparezca: ✅ "Success. No rows returned"

**Verificación:**
Al final del script se ejecuta un `SELECT` que mostrará las configuraciones creadas automáticamente para cada sede.

---

### **PASO 2: Crear bucket de Storage para logos**

#### 2.1 Crear el Bucket (UI)
1. Ve a **Supabase Dashboard** > **Storage**
2. Click en **"New bucket"**
3. Configuración:
   - **Name:** `school-assets`
   - **Public:** ✅ **ACTIVADO** (para que los logos sean públicos)
   - **File size limit:** 2 MB
   - **Allowed MIME types:** `image/png, image/jpeg, image/svg+xml, image/webp`
4. Click en **"Create bucket"**

#### 2.2 Configurar Políticas de Acceso (SQL)
1. Ve a **Supabase Dashboard** > **SQL Editor**
2. Abre el archivo: `supabase/migrations/SETUP_STORAGE_BUCKET.sql`
3. Copia todo el contenido SQL (las políticas) y ejecútalo
4. Verifica que se hayan creado 4 políticas:
   - ✅ Public read access
   - ✅ SuperAdmin can upload
   - ✅ SuperAdmin can update
   - ✅ SuperAdmin can delete

---

### **PASO 3: Desplegar en Vercel (si aplica)**

Si ya desplegaste el código:

```bash
git add .
git commit -m "feat: módulo configuración de impresoras por sede"
git push origin main
```

Vercel desplegará automáticamente en 1-2 minutos.

---

## 🖼️ Características del Módulo

### **Tab 1: General**
- Nombre de la impresora
- Ancho del papel (58mm, 80mm, 110mm)
- Nombre del negocio/institución
- RUC (11 dígitos)
- Dirección completa
- Teléfono de contacto
- Switch para activar/desactivar configuración

### **Tab 2: Logo**
- Upload de imagen (PNG, JPG, SVG, WebP)
- Tamaño máximo: 2MB
- Ajuste de ancho/alto en pixeles
- Vista previa en tiempo real

### **Tab 3: Formato Ticket**
- **Encabezado:** Texto personalizable, activable/desactivable
- **Pie de página:** Texto personalizable, activable/desactivable
- **Tamaño fuente:** Pequeña / Normal / Grande
- **Copias:** Número de copias por defecto (1-5)
- **Código QR:** Para validación de tickets
- **Código de Barras:** Para escaneo de tickets
- **Impresión Automática:** Imprimir después de venta sin confirmación

### **Tab 4: Vista Previa**
- Simulación visual del ticket
- Se actualiza en tiempo real con los cambios
- Muestra logo, información del negocio, productos de ejemplo
- Respeta el ancho de papel configurado

---

## 🔐 Permisos y Seguridad

### **Roles con Acceso:**

| Rol | Ver Config | Editar Config | Usar para Imprimir |
|-----|-----------|--------------|-------------------|
| **SuperAdmin** | ✅ Todas las sedes | ✅ Todas las sedes | ✅ |
| **Admin General** | ✅ Su sede | ❌ | ✅ |
| **Cajero** | ✅ Su sede | ❌ | ✅ |
| **Gestor Unidad** | ✅ Su sede | ❌ | ✅ |

### **Row Level Security (RLS):**
- Las configuraciones están protegidas por RLS
- Solo SuperAdmin puede crear/editar configuraciones
- Otros roles solo pueden **leer** la configuración de su sede asignada

---

## 📊 Estructura de la Tabla `printer_configs`

```sql
CREATE TABLE printer_configs (
  id UUID PRIMARY KEY,
  school_id UUID REFERENCES schools(id),
  
  -- Básico
  printer_name VARCHAR(100),
  is_active BOOLEAN,
  
  -- Logo
  logo_url TEXT,
  logo_width INTEGER,
  logo_height INTEGER,
  
  -- Papel
  paper_width INTEGER, -- 58, 80, 110 mm
  
  -- Contenido
  print_header BOOLEAN,
  print_footer BOOLEAN,
  header_text TEXT,
  footer_text TEXT,
  
  -- Negocio
  business_name TEXT,
  business_address TEXT,
  business_phone VARCHAR(50),
  business_ruc VARCHAR(20),
  
  -- Formato
  font_size VARCHAR(20), -- small, normal, large
  font_family VARCHAR(50),
  show_qr_code BOOLEAN,
  show_barcode BOOLEAN,
  auto_print BOOLEAN,
  copies INTEGER,
  
  -- Plantilla personalizada (JSON)
  custom_template JSONB,
  
  -- Auditoría
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by UUID,
  updated_by UUID
);
```

---

## 🧪 Testing

### **Cómo probar el módulo:**

1. **Login como SuperAdmin**
2. Ir a **Panel SuperAdmin** > **Tab "Impresoras"**
3. Seleccionar una sede del dropdown
4. Configurar:
   - ✅ Subir un logo de prueba
   - ✅ Completar datos del negocio
   - ✅ Personalizar encabezado/pie de página
   - ✅ Activar/desactivar opciones (QR, barcode, auto-print)
5. Ir al **Tab "Vista Previa"** para ver cómo se verá el ticket
6. Click en **"Guardar Configuración"**
7. Recargar la página y verificar que los datos se hayan guardado

### **Verificar Storage:**
1. Ve a **Supabase Dashboard** > **Storage** > **school-assets**
2. Deberías ver la carpeta `printer-logos/`
3. Dentro habrá archivos con formato: `{school_id}-{timestamp}.{ext}`

---

## 🔄 Integración con POS

Cuando los cajeros hagan una venta en el POS, podrán:

1. Obtener la configuración activa de su sede:
```typescript
const { data: config } = await supabase
  .from('printer_configs')
  .select('*')
  .eq('school_id', userSchoolId)
  .eq('is_active', true)
  .single();
```

2. Usar esa configuración para:
   - Mostrar el logo correcto
   - Aplicar el formato del ticket
   - Imprimir automáticamente si `auto_print = true`
   - Generar el número de copias configurado

---

## 📱 Próximas Mejoras (Opcional)

- [ ] Editor visual de plantillas (drag & drop)
- [ ] Múltiples configuraciones por sede (día/noche)
- [ ] Templates prediseñados
- [ ] Test de impresión directa desde el módulo
- [ ] Historial de cambios de configuración
- [ ] Export/Import de configuraciones entre sedes

---

## ❓ Preguntas Frecuentes

**P: ¿Puedo tener múltiples configuraciones activas por sede?**
R: No, el sistema solo permite UNA configuración activa por sede (constraint en la DB).

**P: ¿Qué pasa si no subo un logo?**
R: El ticket se imprimirá sin logo, mostrando solo la información del negocio.

**P: ¿Cómo elimino un logo una vez subido?**
R: Actualmente debes subir un nuevo logo para reemplazar el anterior. El sistema sobrescribe automáticamente.

**P: ¿Los logos se eliminan si borro una configuración?**
R: No automáticamente. Se recomienda eliminar manualmente del Storage si es necesario.

---

## 🆘 Troubleshooting

### Error: "Failed to upload logo"
- Verifica que el bucket `school-assets` existe y es público
- Verifica que las políticas de Storage estén correctamente configuradas
- Verifica que el archivo sea menor a 2MB

### Error: "Database error saving configuration"
- Verifica que la tabla `printer_configs` existe
- Verifica que el usuario tiene el rol `superadmin`
- Revisa los logs en Supabase Dashboard > Logs

### La vista previa no se actualiza
- Es un issue de caché del navegador, prueba con Ctrl+F5
- Verifica que los estados de React se estén actualizando

---

## ✅ Checklist de Implementación

- [ ] Ejecutar `CREATE_PRINTER_CONFIGS.sql` en Supabase
- [ ] Crear bucket `school-assets` en Supabase Storage
- [ ] Ejecutar `SETUP_STORAGE_BUCKET.sql` para políticas
- [ ] Verificar que aparece el tab "Impresoras" en SuperAdmin
- [ ] Probar subida de logo
- [ ] Probar guardado de configuración
- [ ] Verificar vista previa del ticket
- [ ] Desplegar a Vercel (si aplica)

---

**🎉 ¡Listo! El módulo de Configuración de Impresoras está completamente implementado.**
