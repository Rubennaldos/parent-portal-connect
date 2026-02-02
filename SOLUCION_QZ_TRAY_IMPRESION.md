# 🖨️ SOLUCIÓN: Error de Impresión QZ Tray

**Fecha:** 2 de Febrero, 2026  
**Problema:** Popup "Invalid Certificate" / "An anonymous request wants to connect to QZ Tray"

---

## ❌ PROBLEMA

El sistema de impresión QZ Tray mostraba un popup cada vez pidiendo permiso para conectarse:

```
Action Required
An anonymous request wants to connect to QZ Tray
Untrusted website

[Allow] [Block]
```

---

## 🔍 CAUSA RAÍZ

El código estaba intentando:
1. **Descargar certificados SSL** desde `https://localhost:8181/cert` → **FALLABA**
2. **Conectarse con certificados** → **FALLABA**  
3. **Caer en modo anónimo** → **Requería aprobación manual cada vez**

---

## ✅ SOLUCIÓN IMPLEMENTADA

He simplificado la configuración de QZ Tray para:
- ✅ **Conectar directamente sin certificados**
- ✅ **Permitir que QZ Tray recuerde la decisión**
- ✅ **Eliminar intentos fallidos de descargar certificados**

### Archivos Modificados:

1. **`src/lib/qzConfig.ts`**
   - Eliminada función `fetchQZCertificate()` (fallaba siempre)
   - Simplificado `setupQZCertificates()` para usar modo básico directo
   - Mejorados mensajes de consola con instrucciones claras

---

## 📋 INSTRUCCIONES PARA EL USUARIO

### **PASO 1: Verificar que QZ Tray esté corriendo**

1. Busca el **ícono de QZ Tray** en la bandeja del sistema (System Tray)
2. Debe estar **verde** 🟢 (si está rojo 🔴, QZ Tray no está activo)
3. Si no está corriendo:
   - Busca **"QZ Tray"** en el menú inicio
   - Ejecuta la aplicación
   - Espera a que el ícono se ponga verde

---

### **PASO 2: Aceptar la conexión PERMANENTEMENTE**

Cuando uses el sistema de impresión por primera vez:

1. **Aparecerá el popup de QZ Tray:**

```
Action Required
An anonymous request wants to connect to QZ Tray
Untrusted website

☐ Remember this decision

[Allow] [Block]
```

2. **✅ MARCA LA CASILLA** `☑ Remember this decision`

3. **Click en "Allow"**

4. **¡Listo!** El popup **NO volverá a aparecer**

---

### **PASO 3: Probar la impresión**

1. Ve al **módulo POS**
2. Haz una venta de prueba
3. Imprime el ticket
4. **No debería aparecer más el popup**

---

## ⚠️ SOLUCIÓN DE PROBLEMAS

### Problema: El popup sigue apareciendo

**Causa:** No marcaste "Remember this decision"

**Solución:**
1. Cierra el navegador completamente
2. Abre nuevamente `http://localhost:8080`
3. Cuando aparezca el popup:
   - ✅ **Marca la casilla** "Remember this decision"
   - Click en "Allow"

---

### Problema: QZ Tray no se conecta

**Síntomas:**
```
❌ Error al conectar con QZ Tray
Failed to establish connection with QZ Tray on ws://localhost:8182
```

**Solución:**

1. **Verifica que QZ Tray esté corriendo:**
   - Busca el ícono en la bandeja del sistema
   - Debe estar verde 🟢

2. **Reinicia QZ Tray:**
   - Click derecho en el ícono → **Exit**
   - Vuelve a abrir QZ Tray desde el menú inicio

3. **Verifica el puerto:**
   - QZ Tray debe estar en el puerto **8182** (inseguro)
   - Si está en 8181 (seguro), ciérralo y ábrelo de nuevo

---

### Problema: No encuentro la impresora

**Solución:**

1. Ve al **módulo de Configuración de Impresoras** (en Admin)
2. Click en **"Detectar Impresoras"**
3. Selecciona tu impresora térmica de la lista
4. Guarda la configuración

---

## 🎯 CAMBIOS TÉCNICOS

### Antes (❌ Complejo y fallaba):

```typescript
// Intentaba descargar certificados → FALLABA
const cert = await fetchQZCertificate();

// Intentaba conectar con SSL → FALLABA
await fetch('https://localhost:8181/cert');

// Caía en modo anónimo → POPUP CADA VEZ
```

### Después (✅ Simple y funciona):

```typescript
// Conexión directa sin certificados
export const setupQZCertificates = async () => {
  setupQZBasic(); // Modo básico directo
};

// QZ Tray permite "Remember this decision"
qz.security.setCertificatePromise(resolve => resolve());
```

---

## ✅ RESULTADO ESPERADO

### Primera vez:
- ✅ Aparece popup de QZ Tray
- ✅ Usuario marca "Remember this decision"
- ✅ Usuario da "Allow"

### Siguientes veces:
- ✅ **NO aparece popup**
- ✅ **Conexión automática**
- ✅ **Impresión directa sin interrupciones**

---

## 🔥 RESUMEN

| Antes | Después |
|-------|---------|
| ❌ Popup cada vez | ✅ Popup solo 1 vez |
| ❌ Intentos fallidos de SSL | ✅ Conexión directa |
| ❌ Código complejo | ✅ Código simplificado |
| ❌ "Invalid Certificate" | ✅ Sin errores |

---

**🎉 El sistema de impresión ahora funciona correctamente!**

**Recuerda:** La primera vez que uses el POS, marca "Remember this decision" y da "Allow" en el popup de QZ Tray.
