# 📋 Sistema de Precios Diferenciados por Sede

## 🎯 Objetivo
Permitir que cada producto tenga precios distintos en cada colegio/sede, sin duplicar productos y manteniendo una gestión centralizada e intuitiva.

---

## 🏗️ Arquitectura de la Solución

### 1. **Base de Datos**
Se creó la tabla `product_school_prices` que almacena **sobrescrituras** de precios. Si no existe un registro personalizado, el sistema usa automáticamente el **precio base** del producto.

**Ventajas:**
- ✅ No necesitas crear registros para todas las sedes
- ✅ Solo guardas lo que es diferente
- ✅ Si cambias el precio base, se aplica automáticamente a todas las sedes que no tengan precio personalizado
- ✅ Puedes desactivar un producto en una sede específica sin eliminarlo

### 2. **Interfaz Visual**
Se agregó un botón **"Precios"** (ícono de edificio 🏢) en cada producto de la lista de productos.

**Al hacer clic se abre una tabla donde:**
- Ves todas tus sedes en filas
- Puedes editar el precio de venta y costo para cada una
- Dejas el campo **en blanco** para usar el precio base automáticamente
- Activas/desactivas el switch si el producto está disponible en esa sede
- Ves un badge "Personalizado" en las sedes que tienen precio diferente
- Botón de reset para volver al precio base

### 3. **POS Inteligente**
El sistema POS ahora:
- Detecta automáticamente la sede del usuario logueado
- Carga los productos con los precios correctos para esa sede
- Muestra el precio personalizado si existe, o el precio base si no
- Todo es transparente para el cajero (no necesita hacer nada especial)

---

## 📖 Guía de Uso

### **Paso 1: Ejecutar el Script SQL**
1. Abre Supabase > SQL Editor
2. Copia y pega el contenido de `SETUP_PRECIOS_POR_SEDE.sql`
3. Ejecuta el script (esto crea la tabla, índices, políticas RLS y funciones auxiliares)
4. Verifica que no haya errores

### **Paso 2: Configurar Precios por Sede**
1. Ve al módulo **Gestión de Productos**
2. En la pestaña **"Productos"**, haz clic en el botón **"Precios"** del producto que quieras configurar
3. Se abrirá una tabla con todas tus sedes
4. **Para cada sede:**
   - **Dejar en blanco** = Usa el precio base (S/ XX.XX)
   - **Escribir un número** = Sobrescribe el precio solo para esa sede
   - **Desactivar el switch** = El producto NO estará disponible en esa sede (aunque esté activo globalmente)
5. Haz clic en **"Guardar Cambios"**

### **Paso 3: Verificar en el POS**
1. Inicia sesión con un usuario de una sede específica (operador_caja, gestor_unidad, etc.)
2. El POS cargará automáticamente los productos con los precios correctos de esa sede
3. En la consola del navegador (F12) verás logs como:
   ```
   🏫 POS - Sede del usuario: abc-123-def
   💰 POS - Productos con precio personalizado: 5
   ```

---

## 🎨 Ejemplo Práctico

### Escenario:
Tienes **Coca Cola 500ml** que cuesta **S/ 3.50** (precio base).

**En la sede "Miraflores"** quieres venderla a **S/ 4.00** porque la renta es más alta.
**En la sede "Los Olivos"** la vendes al precio base.
**En la sede "San Miguel"** no vendes bebidas gaseosas (desactivada).

### Configuración:
1. Abre el modal de precios de "Coca Cola 500ml"
2. **Miraflores**: Escribe `4.00` en "Precio Venta"
3. **Los Olivos**: Deja en blanco (usará 3.50 automático)
4. **San Miguel**: Desactiva el switch "Disponible"
5. Guarda

### Resultado:
- El cajero de **Miraflores** verá Coca Cola a **S/ 4.00**
- El cajero de **Los Olivos** verá Coca Cola a **S/ 3.50**
- El cajero de **San Miguel** **NO** verá Coca Cola en su lista de productos

---

## 🔧 Funciones Auxiliares Creadas

### `get_product_price_for_school(product_id, school_id)`
Función SQL que devuelve el precio efectivo de un producto en una sede.

### `getProductsForSchool(schoolId)`
Función TypeScript que obtiene todos los productos con precios ajustados para una sede.

### Vista Materializada: `mv_products_with_school_prices`
Combina productos + sedes + precios en una sola tabla optimizada para consultas rápidas.

---

## 🛡️ Seguridad (RLS)

- **Admin General**: Ve y edita precios de todas las sedes
- **Supervisor de Red**: Ve y edita precios de todas las sedes
- **Gestor de Unidad**: Solo ve precios de su sede asignada
- **Operador de Caja**: El sistema carga automáticamente los precios de su sede (no necesita permisos especiales en esta tabla)

---

## 💡 Tips y Mejores Prácticas

1. **Usa el precio base como referencia estándar**
   - Solo personaliza cuando sea realmente necesario
   - Esto facilita los cambios masivos de precios

2. **Revisa periódicamente los precios personalizados**
   - Usa el badge "Personalizado" para identificarlos rápido
   - Considera si aún tiene sentido mantener esa diferencia

3. **Para cambios masivos de precio**
   - Cambia el precio base del producto
   - Solo afectará a las sedes que NO tienen precio personalizado
   - Las personalizadas se mantendrán como están (por diseño)

4. **Reporte de precios por sede**
   - Puedes consultar la vista `mv_products_with_school_prices` directamente en SQL
   - Ejemplo:
     ```sql
     SELECT school_name, product_name, effective_price_sale, has_custom_price
     FROM mv_products_with_school_prices
     WHERE school_name = 'Miraflores'
     ORDER BY product_name;
     ```

---

## 🚀 Próximas Mejoras (Opcional)

- [ ] Exportar matriz de precios completa a Excel
- [ ] Copiar precios de una sede a otra
- [ ] Historial de cambios de precios por sede
- [ ] Alertas cuando el margen de ganancia sea muy bajo en alguna sede
- [ ] Dashboard comparativo de precios entre sedes

---

## ❓ Preguntas Frecuentes

**P: ¿Qué pasa si creo un producto nuevo?**
R: Por defecto, se aplicará el precio base en todas las sedes. Luego puedes personalizarlo donde sea necesario.

**P: ¿Puedo tener un producto disponible solo en algunas sedes?**
R: Sí. Marca como activo el producto globalmente, y luego desactiva el switch en las sedes donde NO quieras que aparezca.

**P: ¿El cajero necesita hacer algo especial?**
R: No. El sistema detecta automáticamente su sede y carga los precios correctos.

**P: ¿Cómo sé si un producto tiene precios personalizados?**
R: En el modal de precios, las filas con precios personalizados muestran un badge naranja "Personalizado".

**P: ¿Puedo volver al precio base después de personalizarlo?**
R: Sí. Haz clic en el botón de reset (ícono de recarga) al lado de "Personalizado", o simplemente borra el valor del campo.

---

**Fecha de implementación:** Enero 2026  
**Versión del sistema:** 1.2.3+  
**Desarrollado por:** ARQUISIA Soluciones
