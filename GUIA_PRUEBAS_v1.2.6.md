# 🧪 GUÍA DE PRUEBAS - VERSIÓN 1.2.6

## 📋 CHECKLIST DE PRUEBAS:

### ✅ 1. VERIFICAR DEPLOY EN VERCEL
```
1. Ir a: https://vercel.com/
2. Login con tu cuenta
3. Buscar: parent-portal-connect
4. Estado debe ser: ✅ Ready
5. Versión debe decir: 1.2.6
```

---

### ✅ 2. EJECUTAR SQL EN SUPABASE

**Orden de ejecución:**

#### A. Sistema de Tickets Personalizados
```sql
Archivo: INSTALAR_TICKETS_PERSONALIZADOS.sql
```
**Resultado esperado:**
```
✅ Sistema de tickets con prefijos personalizados instalado
```

#### B. Sistema de Delay de Visualización
```sql
Archivo: SETUP_PURCHASE_VISIBILITY_DELAY.sql
```
**Resultado esperado:**
```
✅ Sistema de delay de visualización instalado correctamente
```

#### C. Crear Deuda de Prueba
```sql
Archivo: CREAR_DEUDA_AUTOMATICA.sql
```
**Resultado esperado:**
```
✅ Deuda de prueba creada exitosamente
📋 Estudiante: [Nombre del estudiante]
💰 Monto: S/ 35.00
📧 Padre: [email@ejemplo.com]
```

---

### ✅ 3. PROBAR REGISTRO DE PADRES

**Link:**
```
https://parent-portal-connect.vercel.app/register
```

**Flujo de prueba:**
1. Abrir el link
2. Seleccionar una sede
3. Ingresar email (ejemplo: `padre.prueba@gmail.com`)
4. Ingresar contraseña (mínimo 6 caracteres)
5. Confirmar contraseña
6. Click en "Registrarse"
7. ✅ Debería redirigir al portal de padres

**O registrarse con Google:**
1. Click en "Continuar con Google"
2. Elegir cuenta de Google
3. ✅ Debería redirigir al portal

---

### ✅ 4. PROBAR MÓDULO DE COBRANZAS

**Como Admin General:**

1. Login: `superadmin@limacafe28.com`
2. Ir a: **Dashboard** → **Cobranzas**
3. Verificar pestañas:
   - ✅ **Dashboard** (debe incluir estadísticas al final)
   - ✅ **¡Cobrar!** (con exclamación)
   - ✅ **Reportes**
   - ✅ **Config**

4. Verificar que NO aparezca pestaña separada de "Estadísticas"

---

### ✅ 5. PROBAR SISTEMA DE TICKETS

**En el POS:**

1. Login como Admin General
2. Ir a: **POS**
3. Hacer una venta de prueba
4. ✅ El ticket debe generarse como: `T-XX-000001`
   - Donde `XX` son las iniciales del usuario

**En Módulo de Ventas:**

1. Ir a: **Ventas** → **Lista de Ventas**
2. Verificar que los tickets se muestren:
   ```
   📄 T-AG-000001  🕐 23/01/2026 14:35
   🏫 Sede Lima
   👤 Cliente Genérico         S/ 25.50
   ```

3. ✅ Fecha y hora deben ser MÁS GRANDES que antes

---

### ✅ 6. PROBAR SISTEMA DE DELAY

**Como Admin General:**

1. Ir a: **Ventas** → **Config. Visualización**
2. Verificar que aparezcan todas las sedes
3. Cada sede debe mostrar: **"2 días de retraso"** (default)
4. Click en **"Configurar"** en una sede
5. Cambiar a: **"1 día atrás"**
6. Click en **"Guardar Configuración"**
7. ✅ Debería guardar exitosamente

**Como Padre:**

1. Login con el padre de prueba
2. Ir a pestaña: **"Pagos"**
3. ✅ Solo deben aparecer deudas de hace 2+ días
4. Ir a: **"Historial de Compras"** de un estudiante
5. ✅ Solo deben aparecer compras hasta hace 2 días

**Verificar en Consola (F12):**
```
📅 Filtro de delay aplicado: { 
  delayDays: 2, 
  cutoffDate: '21/01/2026',
  message: 'Mostrando solo compras hasta hace 2 días' 
}
```

---

### ✅ 7. PROBAR PASARELA DE PAGOS

**Como Padre:**

1. Login con cuenta de padre
2. Ir a pestaña: **"Pagos"**
3. ✅ Debería aparecer la deuda de prueba: **S/ 35.00**
4. Seleccionar la deuda (checkbox)
5. Click en **"Pagar Seleccionados"**
6. ✅ Debería abrir modal con opciones:
   - Yape
   - Plin
   - Tarjeta
   - Transferencia
7. Seleccionar un método
8. Click en **"Confirmar Pago"**
9. ✅ Debería procesar el pago

**Verificar después del pago:**
1. Recargar la página
2. La deuda debería haber desaparecido de "Pagos"
3. Ir a "Historial"
4. ✅ Debería aparecer como "PAGADA"

---

### ✅ 8. PROBAR MÓDULO DE COBRANZAS (ADMIN)

**Como Admin General:**

1. Ir a: **Cobranzas** → **¡Cobrar!**
2. Seleccionar fecha
3. ✅ Deberían aparecer TODAS las deudas (sin delay)
4. Los admins ven TODO en tiempo real
5. Pueden cobrar cuando sepan que ya pasaron el cuaderno

---

## 🐛 PROBLEMAS COMUNES:

### Problema 1: Deploy no se refleja
```bash
Solución:
1. Ctrl + Shift + R (recarga forzada)
2. Borrar caché del navegador
3. Abrir en ventana incógnito
```

### Problema 2: SQL da error
```
Error típico: "relation already exists"
Solución: El SQL ya se ejecutó antes, verificar con:
SELECT * FROM purchase_visibility_delay;
```

### Problema 3: No aparece la deuda de prueba
```
Verificar:
1. ¿Ejecutaste CREAR_DEUDA_AUTOMATICA.sql?
2. ¿El delay está activo? (si es 2 días, la deuda debe ser de hace 3+ días)
3. Revisar en SQL:
   SELECT * FROM transactions WHERE ticket_code LIKE 'DEUDA-TEST-%';
```

### Problema 4: Padre no puede registrarse
```
Verificar en Supabase:
1. Authentication → Settings → Auth Providers
2. Email debe estar habilitado
3. Google OAuth debe estar configurado (opcional)
```

---

## 📊 RESUMEN DE CAMBIOS v1.2.6:

```
✅ Sistema de delay de visualización
   - Default: 2 días
   - Configurable por sede
   - Padres solo ven compras antiguas
   - Admins ven TODO en vivo

✅ Tickets personalizados
   - Formato: T-AG-000001
   - Prefijo por usuario
   - Numeración correlativa

✅ Módulo Cobranzas mejorado
   - "¡Cobrar!" con exclamación
   - Dashboard + Estadísticas juntos
   - Menos pestañas, más limpio

✅ Visualización mejorada
   - Fecha y hora más grandes
   - Mejor legibilidad
   - Información más clara
```

---

## 🎯 PRÓXIMOS PASOS:

1. ✅ Ejecutar todos los SQL
2. ✅ Probar registro de padres
3. ✅ Verificar delay funciona
4. ✅ Probar pasarela de pagos
5. ✅ Confirmar deploy en Vercel
6. 📝 Enviar mensaje a Fiorella sobre el cuaderno

---

**Fecha:** 23 enero, 2026  
**Versión:** 1.2.6-beta  
**Estado:** ✅ Desplegado y listo para probar
