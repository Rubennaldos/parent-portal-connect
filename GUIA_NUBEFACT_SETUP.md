# 🧾 GUÍA COMPLETA: SETUP NUBEFACT + FACTURACIÓN ELECTRÓNICA

## 📋 **TABLA DE CONTENIDOS**
1. [Crear Cuenta en Nubefact](#crear-cuenta)
2. [Configurar Multi-RUC](#configurar-multi-ruc)
3. [Ejecutar Script SQL](#ejecutar-sql)
4. [Configurar Base de Datos](#configurar-bd)
5. [Próximos Pasos](#proximos-pasos)

---

## 🚀 **1. CREAR CUENTA EN NUBEFACT** {#crear-cuenta}

### **Paso 1.1: Registro**
1. Ir a: https://nubefact.com/registro
2. Completar:
   ```
   Nombre: Tu nombre
   Correo: tu_correo@gmail.com
   Celular: 999888777
   Contraseña: (tu contraseña segura)
   ```
3. Clic en **"Crear cuenta gratis"**
4. Verifica tu correo (te llega un link)
5. Haz clic en el link para activar

### **Paso 1.2: Elegir Plan Ilimitado**
1. Inicia sesión en Nubefact
2. Ve a: **"Mi Cuenta"** → **"Planes"**
3. Selecciona: **"Plan Ilimitado"** (S/ 69/mes)
4. Método de pago:
   - Tarjeta de crédito/débito
   - O solicita factura para pago por transferencia
5. Activa el plan

### **Paso 1.3: Obtener Token de API**
1. Ve a: **"API"** → **"Token de Acceso"**
2. Copia tu **Token de API**
3. **IMPORTANTE:** Guárdalo en un archivo seguro
4. Formato del token:
   ```
   eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMzQ1...
   ```

---

## 🏢 **2. CONFIGURAR MULTI-RUC** {#configurar-multi-ruc}

### **Por cada empresa de tus clientes:**

#### **Paso 2.1: Agregar Empresa**
1. En Nubefact, ve a: **"Empresas"** → **"Agregar Empresa"**
2. Completa:
   ```
   RUC: 20123456789
   Razón Social: INVERSIONES EDUCATIVAS SAC
   Nombre Comercial: Lima Café 28
   Dirección: Av. Larco 1234, Miraflores, Lima
   Ubigeo: 150122 (Lima - Lima - Miraflores)
   Teléfono: 01-4567890
   Email: contabilidad@empresa.com
   ```
3. **Subir Logo:**
   - Formato: PNG o JPG
   - Tamaño: Máx 500KB
   - Recomendado: 200x200px, fondo transparente

#### **Paso 2.2: Configurar Certificado Digital**

**OPCIÓN A: Nubefact genera automáticamente (RECOMENDADO)**
1. Dentro de la empresa, ve a: **"Certificado Digital"**
2. Clic en: **"Generar Certificado Automático"**
3. Ingresa:
   ```
   Usuario SOL: 20123456789ADMINUSER
   Clave SOL: ********
   ```
4. Nubefact se conecta a SUNAT y genera el certificado
5. ✅ Listo en 2-3 minutos

**OPCIÓN B: Cliente tiene certificado propio**
1. Solicita al cliente:
   - Archivo `.PFX` o `.P12`
   - Contraseña del certificado
2. En Nubefact: **"Certificado Digital"** → **"Subir Certificado"**
3. Selecciona archivo y ingresa contraseña
4. ✅ Listo

#### **Paso 2.3: Configurar Series de Comprobantes**
1. Ve a: **"Configuración"** → **"Series"**
2. Configura las series:

   **Para Boletas:**
   ```
   Serie: B001
   Correlativo inicial: 1
   ```

   **Para Facturas:**
   ```
   Serie: F001
   Correlativo inicial: 1
   ```

   **Para Notas de Crédito (Boleta):**
   ```
   Serie: BC01
   Correlativo inicial: 1
   ```

   **Para Notas de Crédito (Factura):**
   ```
   Serie: FC01
   Correlativo inicial: 1
   ```

   **Para Notas de Débito (Boleta):**
   ```
   Serie: BD01
   Correlativo inicial: 1
   ```

   **Para Notas de Débito (Factura):**
   ```
   Serie: FD01
   Correlativo inicial: 1
   ```

   **Para Guías de Remisión:**
   ```
   Serie: T001
   Correlativo inicial: 1
   ```

3. Guarda cada serie

#### **Paso 2.4: Modo Sandbox (Pruebas)**
1. Nubefact te da acceso automático a **Sandbox**
2. Activa el modo sandbox:
   - En el dashboard, cambia a **"Modo Pruebas"**
3. **URLs de API:**
   - Producción: `https://api.nubefact.com/api-v1/`
   - Sandbox: `https://api.nubefact.com/api-sandbox/`

---

## 💾 **3. EJECUTAR SCRIPT SQL** {#ejecutar-sql}

### **Paso 3.1: Conectar a Supabase**
1. Ve a: https://supabase.com/dashboard
2. Selecciona tu proyecto
3. Ve a: **"SQL Editor"**

### **Paso 3.2: Ejecutar Script**
1. Abre el archivo: `SETUP_FACTURACION_ELECTRONICA.sql`
2. Copia TODO el contenido
3. Pega en el SQL Editor de Supabase
4. Clic en **"Run"** (▶ ejecutar)
5. Espera 10-15 segundos
6. Verifica que no haya errores

### **Paso 3.3: Verificar Tablas Creadas**
Ejecuta este query para verificar:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'nubefact_config',
    'invoices',
    'invoice_items',
    'invoicing_logs'
)
ORDER BY table_name;
```

Deberías ver:
```
table_name
------------------
invoice_items
invoices
invoicing_logs
nubefact_config
```

---

## ⚙️ **4. CONFIGURAR BASE DE DATOS** {#configurar-bd}

### **Paso 4.1: Insertar Configuración de Nubefact**

Por cada empresa/sede, ejecuta (reemplaza los valores):

```sql
INSERT INTO public.nubefact_config (
    school_id,
    ruc,
    razon_social,
    direccion_fiscal,
    ubigeo,
    nubefact_token,
    is_sandbox,
    serie_boleta,
    serie_factura,
    email_envio,
    telefono,
    logo_url
) VALUES (
    'ID_DE_TU_SEDE', -- Obtén el ID de la tabla schools
    '20123456789', -- RUC del cliente
    'INVERSIONES EDUCATIVAS SAC', -- Razón Social
    'Av. Larco 1234, Miraflores, Lima, Lima', -- Dirección Fiscal
    '150122', -- Ubigeo (6 dígitos)
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...', -- Token de Nubefact (el mismo para todas)
    true, -- true = Sandbox (pruebas), false = Producción
    'B001', -- Serie de boletas
    'F001', -- Serie de facturas
    'facturacion@empresa.com', -- Email para enviar comprobantes
    '01-4567890', -- Teléfono
    'https://url-del-logo.com/logo.png' -- URL del logo (opcional)
);
```

### **Paso 4.2: Obtener School ID**

Si no sabes el `school_id`, ejecuta:
```sql
SELECT id, name FROM public.schools ORDER BY name;
```

Copia el `id` de la sede correspondiente.

### **Paso 4.3: Verificar Configuración**

```sql
SELECT 
    s.name as sede,
    nc.ruc,
    nc.razon_social,
    nc.serie_boleta,
    nc.serie_factura,
    nc.is_sandbox,
    nc.is_active
FROM public.nubefact_config nc
JOIN public.schools s ON s.id = nc.school_id
ORDER BY s.name;
```

---

## 🎯 **5. PRÓXIMOS PASOS** {#proximos-pasos}

### **Fase Actual: Base de Datos** ✅ COMPLETADO

- [x] Tablas creadas
- [x] RLS configurado
- [x] Rol "contadora" agregado
- [x] Configuración de Nubefact lista

### **Fase 2: Edge Function (Próxima)**

Voy a crear:
1. Edge Function: `generate-invoice`
2. Edge Function: `cancel-invoice` (para NC)
3. Edge Function: `consult-document` (para DNI/RUC)

### **Fase 3: Frontend (Después)**

Voy a crear:
1. Módulo "Facturación Electrónica"
2. Modal de comprobante (reutilizable)
3. Integración en POS
4. Integración en Portal Padres
5. Integración en Cobranzas

---

## 📝 **CHECKLIST ANTES DE CONTINUAR**

- [ ] Cuenta en Nubefact creada
- [ ] Plan Ilimitado activado (S/ 69/mes)
- [ ] Token de API copiado y guardado
- [ ] Empresas agregadas en Nubefact (las 3)
- [ ] Certificados digitales configurados
- [ ] Series de comprobantes creadas
- [ ] Script SQL ejecutado en Supabase
- [ ] Configuración insertada en `nubefact_config`

---

## 🆘 **SOPORTE**

Si tienes problemas:
1. **Nubefact:** soporte@nubefact.com / WhatsApp: 987654321
2. **SUNAT:** 0-801-12-100 (consultas SOL)
3. **Yo:** Sigue aquí en el chat 😊

---

## 💰 **RESUMEN DE COSTOS**

| Concepto | Costo | Frecuencia |
|----------|-------|------------|
| Nubefact Ilimitado | S/ 69 | Mensual |
| Certificado Digital | Incluido | - |
| Consultas DNI/RUC | Incluido | Ilimitado |
| Soporte técnico | Incluido | - |
| **TOTAL** | **S/ 69/mes** | - |

**Tus ingresos:** S/ 120/mes (3 clientes x S/ 40)
**Ganancia neta:** S/ 51/mes

---

## ✨ **VENTAJAS DE ESTE SETUP**

✅ **1 cuenta = Múltiples RUCs** (no pagas por cada uno)
✅ **Documentos ilimitados** (sin preocuparte por límites)
✅ **API DNI/RUC incluida** (ahorro de ~S/ 30/mes)
✅ **Certificado digital incluido** (ahorro de ~S/ 80/año)
✅ **Sandbox gratis** (pruebas sin riesgo)
✅ **Escalable** (puedes agregar más clientes sin costo extra)

---

*Fecha: 26 Enero 2026*
*Version: 1.3.5*
