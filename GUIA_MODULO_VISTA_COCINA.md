* ACTUALIZACION TAN ESPERADA * 
# 👨‍🍳 GUÍA: MÓDULO VISTA COCINA
## Para Administradores y Personal de Cocina

---

## 🎯 ¿PARA QUÉ ES ESTE MÓDULO?

El **Módulo Vista Cocina** es una **hoja de preparación digital en tiempo real** que muestra exactamente qué y cuánto debe preparar la cocina cada día.

### ❌ **NO es para:**
- Ver quién pidió quE
- Marcar entregas o controlar quién recibió su plato
- Ver estadísticas históricas o reportes financieros
- Gestionar pedidos individuales

### ✅ **SÍ es para:**
- **Saber cuántos platos preparar de cada menú**
- **Ver todas las variaciones y personalizaciones** (ej: "8 platos sin cebolla")
- **Ver todas las guarniciones necesarias** (ej: "15 porciones de papa frita")
- **Leer observaciones especiales** (ej: "Juan García: sin gluten")
- **Tener un resumen claro y detallado** para organizar la producción

---

## 🚀 ¿QUÉ VAN A LOGRAR CON ESTE MÓDULO?

### 1. **Organización Eficiente de la Cocina** 📋
- **Antes:** Tenían que revisar pedido por pedido para saber qué preparar
- **Ahora:** Ven un resumen agrupado por menú con todos los totales

### 2. **Precisión en las Cantidades** 🔢
- **Antes:** Podían contar mal o perderse en los detalles
- **Ahora:** El sistema calcula automáticamente:
  - Total de platos por menú
  - Total de cada variación (ej: "Sin cebolla: 8 platos")
  - Total de cada guarnición (ej: "Papa frita: 15 porciones")

### 3. **No Se Pierden Observaciones Especiales** ⚠️
- **Antes:** Una nota especial podía pasar desapercibida entre cientos de pedidos
- **Ahora:** Todas las observaciones aparecen agrupadas en una sección destacada con el nombre de la persona

### 4. **Actualización en Tiempo Real** ⏱️
- **Antes:** Tenían que esperar a que alguien les trajera una lista impresa
- **Ahora:** El sistema se actualiza automáticamente cada 30 segundos
- Pueden ver el contador de actualización en el botón de refresh

### 5. **Vista Multi-Sede (Solo Admin General)** 🏫
- **Admin General** puede ver todas las sedes a la vez o filtrar por una específica
- **Cocineros de sede** solo ven su propia sede

### 6. **Impresión para la Cocina** 🖨️
- Pueden imprimir el reporte completo para tenerlo en físico en la cocina
- El formato de impresión está optimizado para papel

---

## 📊 ¿CÓMO SE VE EL REPORTE?

### Estructura de cada tarjeta de menú:

```
┌─────────────────────────────────────────────┐
│  #1 Menú                              [ 32 ]│
│  MENÚ COMPLETO                        platos│
├─────────────────────────────────────────────┤
│  🔥 Plato:   Lomo saltado                  │
│  🥗 Entrada: Ensalada mixta                │
│  ☕ Bebida:  Refresco maracuyá             │
│  🍨 Postre:  Mazamorra morada               │
├─ VARIACIONES Y PERSONALIZACIONES ──────────┤
│  Sin cebolla                          8 platos│
│  Con extra arroz                      5 platos│
│  Sin picante                          3 platos│
├─ GUARNICIONES ──────────────────────────────┤
│  Papa frita     15  │  Ensalada  12  │ ... │
├─ OBSERVACIONES ESPECIALES (2) ──────────────┤
│  OBS  Juan García: sin gluten               │
│  OBS  Ana López: alergia al maní            │
└─────────────────────────────────────────────┘
```

### Resumen final del día:

```
┌─────────────────────────────────────────────┐
│  ✅ RESUMEN TOTAL DEL DÍA                  │
├─────────────────────────────────────────────┤
│  ● Menú Completo — Lomo saltado        32  │
│  ● Menú Light — Pollo plancha           13  │
│  ● Menú Vegetariano — Quinoa           8   │
├─────────────────────────────────────────────┤
│  TOTAL A PREPARAR                       53  │
└─────────────────────────────────────────────┘
```

---

## 🔮 FUNCIONALIDAD FUTURA: CALCULADORA DE PORCIONES

### 🎯 **¿Qué se va a agregar?**

Más adelante, el sistema podrá calcular automáticamente **cuántos gramos de cada ingrediente** necesitas según la cantidad de platos.

### 📝 **Ejemplo de cómo funcionará:**

Si tienes que preparar **32 platos de Lomo Saltado**, el sistema te dirá:

```
┌─────────────────────────────────────────────┐
│  INGREDIENTES NECESARIOS (32 platos)       │
├─────────────────────────────────────────────┤
│  🥩 Lomo de res:        2,400 g (2.4 kg)    │
│  🍚 Arroz:              1,600 g (1.6 kg)   │
│  🥔 Papa:               1,920 g (1.9 kg)   │
│  🍅 Tomate:               640 g (0.6 kg)    │
│  🧅 Cebolla:              480 g (0.5 kg)   │
│  🌶️ Ají amarillo:        160 g (0.2 kg)    │
│  🧄 Ajo:                  32 g             │
│  🫒 Aceite:              320 ml            │
│  🧂 Sal y especias:        según receta     │
└─────────────────────────────────────────────┘
```

### ⚙️ **¿Cómo se configurará?**

1. **El Admin General** podrá crear "recetas" para cada plato
2. En cada receta, especificará:
   - Nombre del plato (ej: "Lomo Saltado")
   - Cantidad de cada ingrediente por plato (ej: "75g de lomo por plato")
3. **El sistema calculará automáticamente:**
   - Si hay 32 platos de Lomo Saltado
   - Y cada plato lleva 75g de lomo
   - Entonces: 32 × 75g = 2,400g de lomo total

### 🎨 **Ventajas de esta funcionalidad:**

- ✅ **Compra precisa:** Sabes exactamente cuánto comprar
- ✅ **Menos desperdicio:** No compras de más ni de menos
- ✅ **Control de costos:** Puedes calcular el costo por plato
- ✅ **Estandarización:** Todas las sedes usan las mismas porciones
- ✅ **Ahorro de tiempo:** No tienes que calcular manualmente

### ⏳ **Estado actual:**

- ❌ Esta funcionalidad **aún no está implementada**
- ✅ El módulo actual solo muestra **resúmenes de cantidades de platos**
- 🚧 La calculadora de porciones será una **mejora futura**

---

## 📱 ¿CÓMO ACCEDER AL MÓDULO?

### Para Admin General:
1. Iniciar sesión en el sistema
2. Ir al Dashboard
3. Buscar el módulo **"Vista Cocina"** 👨‍🍳
4. Hacer clic para abrir

### Para Cocineros (operador_cocina):
1. Iniciar sesión
2. El módulo aparece automáticamente si tienen permisos
3. Solo verán su sede asignada

---

## 🔄 ACTUALIZACIÓN AUTOMÁTICA

- El sistema se actualiza automáticamente cada **30 segundos**
- Puedes ver el contador en el botón de refresh (ej: "15s" significa que faltan 15 segundos)
- También puedes actualizar manualmente haciendo clic en el botón de refresh

---

## 🖨️ IMPRIMIR EL REPORTE

1. Haz clic en el botón de **imprimir** (icono de impresora) en el header
2. El navegador abrirá el diálogo de impresión
3. Selecciona tu impresora
4. El formato está optimizado para papel A4

---

## ❓ PREGUNTAS FRECUENTES

### ¿Puedo ver pedidos de días anteriores?
- Sí, puedes cambiar la fecha usando el selector de fecha en el header

### ¿Qué pasa si un padre cancela su pedido?
- El pedido desaparece automáticamente del reporte (solo se muestran pedidos activos)

### ¿Puedo ver quién pidió cada plato?
- No, el módulo está diseñado para mostrar solo **qué preparar**, no **para quién**
- Esto mantiene el enfoque en la producción, no en la distribución

### ¿El módulo funciona en celular?
- Sí, está completamente adaptado para móviles y tablets

---

## 📞 SOPORTE

Si tienes dudas o problemas con el módulo:
1. Contacta al **Admin General** de tu sede
2. O al **SuperAdmin** del sistema

---

**Última actualización:** Febrero 2025  
**Versión del módulo:** 2.0 (Solo Resúmenes)
