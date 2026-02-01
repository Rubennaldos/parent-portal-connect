# 🔐 SOLUCIÓN: Pop-up de QZ Tray "Allow / Block"

## ✅ **¿QUÉ ESTÁ PASANDO?**

**¡BUENAS NOTICIAS!** QZ Tray **SÍ está funcionando correctamente** ✨

El pop-up que apareció es **NORMAL** y es una medida de seguridad de QZ Tray para proteger tu impresora.

---

## 🚀 **SOLUCIÓN INMEDIATA (1 click):**

### **Click en "Allow"** ✅

En el diálogo:
```
"An anonymous request wants to access connected printers
Untrusted website"
```

1. ✅ **Click en "Allow"**
2. ✅ **Marca "Remember this decision"** (para que no vuelva a preguntar)

**¡LISTO!** Ahora el ticket debe imprimir correctamente.

---

## 🔍 **¿POR QUÉ APARECE ESTE MENSAJE?**

QZ Tray necesita **permiso explícito** para:
- Acceder a tus impresoras
- Enviar trabajos de impresión
- Proteger contra sitios maliciosos

Es como cuando un sitio web te pide permiso para acceder a tu cámara o micrófono.

---

## 🎯 **OPCIONES PARA ELIMINAR EL POP-UP:**

### **OPCIÓN 1: "Remember this decision"** ⭐ (MÁS FÁCIL)

Cuando hagas click en "Allow", **MARCA LA CASILLA**:
- ☑️ "Remember this decision"

QZ Tray guardará tu decisión y **nunca más preguntará** para este sitio.

---

### **OPCIÓN 2: Configurar Certificado Digital** 🔐 (AVANZADO)

Para producción, puedes generar tu propio certificado:

#### **A) Generar Certificado desde QZ Tray:**

1. Abre QZ Tray (icono en la bandeja)
2. Click derecho → **"Advanced" → "Generate Certificate"**
3. Completa los datos:
   - **Common Name**: `parent-portal-connect`
   - **Organization**: Tu colegio/empresa
   - **Country**: PE
4. Guarda el certificado (.p12 o .pfx)

#### **B) Usar el certificado en la aplicación:**

Reemplaza el contenido de `src/lib/qzConfig.ts` con tu certificado real.

---

## 📋 **PRUEBA ACTUAL:**

### **Lo que DEBERÍAS hacer AHORA:**

1. ✅ Click en "Allow" + marca "Remember"
2. ✅ El ticket debe **imprimir directamente**
3. ✅ El papel debe **cortarse automáticamente** ✂️
4. ✅ Si activaste comanda, imprimirá 2 documentos

---

## 🐛 **SI AÚN NO IMPRIME:**

Verifica en la consola del navegador (F12) si hay errores.

### **Errores comunes:**

#### **1. "Printer not found"**
- **Solución**: Verifica el nombre de la impresora en "General" → "Nombre del Dispositivo"
- Debe coincidir EXACTAMENTE con el nombre de Windows

#### **2. "Connection timeout"**
- **Solución**: Aumenta el timeout en "General" → "Timeout de Conexión"
- Prueba con 10000ms (10 segundos)

#### **3. Sin error, pero no imprime**
- **Solución**: Verifica que la impresora esté encendida y con papel

---

## ✅ **CONFIRMACIÓN DE QUE TODO FUNCIONA:**

En la consola deberías ver:
```
✅ QZ Tray ya está conectado
🖨️ Imprimiendo en: [Nombre de tu impresora]
✅ Ticket impreso exitosamente
```

Y el toast verde: **"✅ Impresión exitosa"**

---

## 📞 **¿NECESITAS MÁS AYUDA?**

Comparte un screenshot de:
1. El pop-up completo
2. La consola del navegador (F12)
3. El nombre de tu impresora en Windows

---

**Última actualización**: 31 Enero 2026
