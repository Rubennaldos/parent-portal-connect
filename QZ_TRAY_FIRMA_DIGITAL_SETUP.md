# 🔐 Configuración de Firma Digital para QZ Tray

**Objetivo:** Eliminar popups de "Action Required" y permitir impresión silenciosa.

---

## ✅ **PASO 1: Generar Certificado (1 vez)**

### **Ejecuta este comando en la terminal:**

```bash
node scripts/generate-qz-cert.js
```

**Esto genera:**
- `qz-certificates/private-key.pem` (privada, NO compartir)
- `qz-certificates/public-key.pem` (pública)
- `qz-certificates/digital-certificate.txt` (certificado)

⚠️ **IMPORTANTE:** `private-key.pem` NO se subirá a GitHub (está en .gitignore)

---

## 📋 **PASO 2: Configurar QZ Tray**

### **Opción A: Agregar certificado via Site Manager**

1. **Abre QZ Tray** (debe estar corriendo)

2. **Click derecho** en el ícono de QZ Tray

3. **Selecciona:** "Site Manager..."

4. **Click en el botón "+"** (agregar)

5. **Completa:**
   - **Organization:** `Parent Portal Connect`
   - **Common Name:** `parent-portal-connect.vercel.app`
   - **Certificate:** Copia el contenido de `qz-certificates/digital-certificate.txt`

6. **Guarda**

7. **Reinicia QZ Tray** (Exit y volver a abrir)

---

### **Opción B: Archivo de configuración (más fácil)**

1. **Cierra QZ Tray** (Exit)

2. **Abre el archivo de configuración:**
   - Windows: `%USERPROFILE%\.qz\qz-tray.properties`
   - Mac: `~/.qz/qz-tray.properties`
   - Linux: `~/.qz/qz-tray.properties`

3. **Agrega al final:**
   ```properties
   # Firma digital - Impresión silenciosa
   security.require-certificate=false
   allow.insecure=false
   trust.certificates=parent-portal-connect.vercel.app
   
   # Sitios permitidos
   whitelist=parent-portal-connect.vercel.app,*.vercel.app,localhost
   ```

4. **Guarda el archivo**

5. **Vuelve a abrir QZ Tray**

---

## 🧪 **PASO 3: Probar**

1. **Ve a:** https://parent-portal-connect.vercel.app

2. **Abre la consola** (F12 → Console)

3. **Ve al POS y haz una venta**

4. **Verifica los logs:**

**✅ Con firma digital (SIN popup):**
```
✅ QZ Tray configurado con firma digital
ℹ️  Impresión silenciosa activada (sin popups)
✅ QZ Tray conectado con firma digital (sin popups)
🖨️ Imprimiendo venta...
✅ Ticket impreso
```

**⚠️ Fallback a modo básico (CON popup):**
```
⚠️ Firma digital no disponible, usando modo básico
✅ QZ Tray conectado en modo básico
```

---

## 🔧 **SOLUCIÓN DE PROBLEMAS:**

### **Problema: Sigue apareciendo popup**

**Causa:** El certificado no está configurado correctamente en QZ Tray.

**Solución:**
1. Verifica que el certificado se agregó en Site Manager
2. O que el archivo `qz-tray.properties` se guardó correctamente
3. Reinicia QZ Tray completamente (Exit y volver a abrir)

---

### **Problema: Error "Failed to get certificate"**

**Causa:** El archivo de certificado no existe o la ruta es incorrecta.

**Solución:**
1. Verifica que ejecutaste `node scripts/generate-qz-cert.js`
2. Verifica que existe `qz-certificates/digital-certificate.txt`
3. Revisa los logs en la consola del navegador

---

### **Problema: "Signing not configured"**

**Causa:** El código no puede cargar el módulo de firma.

**Solución:**
1. Verifica que `src/lib/qzSigning.ts` existe
2. Recarga la página con `Ctrl + Shift + R`
3. Revisa errores en la consola

---

## 🎯 **RESULTADO ESPERADO:**

| Antes | Después |
|-------|---------|
| ❌ Popup cada vez | ✅ Sin popups |
| ⚠️ "Action Required" | ✅ Impresión automática |
| 🐌 Requiere click manual | ⚡ Impresión silenciosa |

---

## 📚 **REFERENCIAS:**

- Documentación oficial: https://qz.io/docs/signing
- Generar certificado: https://qz.io/docs/generate-certificate
- Site Manager: https://qz.io/docs/using-qz-tray

---

## ⚠️ **SEGURIDAD:**

### **¿Es seguro?**

✅ **SÍ**, porque:
- El certificado es autofirmado (controlado por ti)
- Solo funciona en tu dominio específico
- La clave privada NUNCA se sube a GitHub
- La clave privada solo existe en tu computadora local

### **Para máxima seguridad:**

Para entornos de producción grandes, considera:
1. Comprar un certificado de una CA oficial (~$200-500/año)
2. Implementar firma en el backend (no en el frontend)
3. Usar HSM (Hardware Security Module) para la clave privada

---

🔥 **¡Con esto configurado, tendrás impresión silenciosa sin popups!**
