# 🔧 Configuración de QZ Tray para Permitir "Remember this decision"

## ⚠️ PROBLEMA ACTUAL:

Cuando marcas "Remember this decision", QZ Tray **NO guarda** la decisión porque falta un certificado válido.

---

## ✅ SOLUCIÓN: Configurar QZ Tray en Modo "Inseguro"

### **PASO 1: Abrir QZ Tray**

1. Click en el **icono de QZ Tray** en la bandeja del sistema (junto al reloj)
2. Debería aparecer un menú

---

### **PASO 2: Configurar Modo Inseguro**

#### **Opción A: Via Interfaz (Recomendado)**

1. Click derecho en el icono de QZ Tray
2. **"Advanced"** → **"Site Manager"**
3. Busca tu sitio: `localhost:8182` o `parent-portal-connect`
4. Click en **"Trust"** o **"Allow Always"**

#### **Opción B: Via Archivo de Configuración**

1. Cierra QZ Tray completamente (Right click → Exit)
2. Navega a:
   ```
   C:\Users\TU_USUARIO\.qz
   ```
3. Abre el archivo `qz-tray.properties` con Notepad
4. Agrega estas líneas al final:
   ```properties
   # Permitir conexiones sin certificado
   allow.insecure=true
   
   # Permitir recordar decisiones
   trust.anonymous=true
   
   # Sitios confiables
   whitelist=localhost,127.0.0.1
   ```
5. Guarda el archivo
6. Reinicia QZ Tray

---

### **PASO 3: Probar de Nuevo**

1. Recarga la página del sistema
2. Click en **"Imprimir Ticket de Prueba"**
3. Cuando aparezca el diálogo:
   - ✅ Click en **"Allow"**
   - ✅ Marca **"Remember this decision"**
4. **¡Listo!** Ya no debería volver a preguntar

---

## 🎯 SOLUCIÓN ALTERNATIVA: Generar Certificado Propio

Si la configuración anterior no funciona, genera tu certificado:

### **PASO 1: Generar Certificado**

1. Abre QZ Tray
2. Click derecho → **"Advanced"** → **"Certificate Manager"**
3. Click en **"Generate Certificate"**
4. Completa:
   - **Common Name**: `parent-portal-connect`
   - **Organization**: Tu colegio
   - **Country Code**: PE
5. Click **"Generate"**
6. Guarda el archivo `.p12` o `.pfx`

### **PASO 2: Exportar Certificado**

1. En Certificate Manager, selecciona tu certificado
2. Click **"Export"** → **"Public Certificate (PEM)"**
3. Copia el contenido (empieza con `-----BEGIN CERTIFICATE-----`)
4. También exporta **"Private Key (PEM)"**

### **PASO 3: Usar en el Sistema**

Reemplaza en `src/lib/qzConfig.ts`:

```typescript
const QZ_CERTIFICATE = `-----BEGIN CERTIFICATE-----
[PEGA AQUÍ TU CERTIFICADO]
-----END CERTIFICATE-----`;

const QZ_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
[PEGA AQUÍ TU CLAVE PRIVADA]
-----END PRIVATE KEY-----`;
```

---

## 🔍 VERIFICAR QUE FUNCIONA:

Después de configurar, en la consola del navegador deberías ver:

```
✅ QZ Tray ya está conectado
✅ Certificados QZ Tray configurados
🖨️ Imprimiendo en: [Tu impresora]
✅ Ticket impreso exitosamente
```

**Y el pop-up NO debería aparecer más** ✨

---

## 📞 SI SIGUE SIN FUNCIONAR:

Prueba esta configuración temporal:

### **Deshabilitar la verificación de certificados en QZ Tray:**

1. Cierra QZ Tray (Right click → Exit)
2. Abre CMD como Administrador
3. Ejecuta:
   ```cmd
   cd "C:\Program Files\QZ Tray"
   qz-tray.exe --file-override=qz-tray.properties
   ```
4. Crea/edita `qz-tray.properties`:
   ```properties
   security.require-certificate=false
   security.allow-anonymous=true
   ```
5. Reinicia QZ Tray

---

**Última actualización**: 31 Enero 2026
