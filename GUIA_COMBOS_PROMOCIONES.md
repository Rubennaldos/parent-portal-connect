# 🎁 SISTEMA DE COMBOS Y PROMOCIONES

## 📋 Resumen del Sistema

Sistema completo para crear **combos** (agrupación de productos con precio especial) y **promociones** (descuentos sobre productos, categorías o todo el catálogo).

---

## 🎯 Conceptos Principales

### 1. COMBOS
**¿Qué son?**
- Agrupación de 2 o más productos que se venden juntos con un precio especial
- Ejemplo: "Combo Estudiante" = Sándwich + Gaseosa = S/ 5.00

**Características:**
- ✅ Puedes agregar la cantidad de productos que quieras
- ✅ Control automático de stock por producto individual
- ✅ Si un producto tiene stock, se descuenta automáticamente
- ✅ Si ambos productos NO tienen stock activado, no se descuenta nada
- ✅ Precio del combo es fijo (no importa si los productos individuales cambian de precio)
- ✅ Se puede activar/desactivar en cualquier momento

**Ejemplo de Gestión de Stock:**
```
Combo: Galleta + Gaseosa = S/ 5.00

Caso 1: Galleta (con stock: 50) + Gaseosa (sin stock)
→ Al vender, descuenta 1 galleta del inventario, gaseosa no se descuenta

Caso 2: Galleta (sin stock) + Gaseosa (sin stock)
→ Al vender, no se descuenta nada

Caso 3: Galleta (con stock: 50) + Gaseosa (con stock: 100)
→ Al vender, descuenta 1 galleta Y 1 gaseosa del inventario
```

---

### 2. PROMOCIONES
**¿Qué son?**
- Descuentos que se aplican sobre productos individuales o categorías enteras
- Ejemplo: "Todos los sándwiches con 20% de descuento"

**Tipos de Promociones:**

#### A. Por Producto Específico
```
Promoción: 15% descuento en Coca Cola 500ml
→ Solo aplica a ese producto
```

#### B. Por Categoría
```
Promoción: 20% descuento en todos los sándwiches
→ Aplica a TODOS los productos de la categoría "sandwiches"
```

#### C. General (Todos los productos)
```
Promoción: 10% descuento en TODO
→ Aplica a todos los productos del catálogo
```

**Tipos de Descuento:**
1. **Porcentaje (%)**: 20% de descuento
2. **Monto Fijo (S/)**: S/ 2.00 de descuento

---

## 🗂️ Estructura de Base de Datos

### Tabla: `combos`
```sql
id              UUID
name            VARCHAR(200)   -- "Combo Estudiante"
description     TEXT           -- "Sándwich + Gaseosa"
combo_price     DECIMAL(10,2)  -- 5.00
image_url       TEXT           -- Imagen del combo (opcional)
active          BOOLEAN        -- true/false
valid_from      DATE           -- Desde cuándo es válido (opcional)
valid_until     DATE           -- Hasta cuándo es válido (opcional)
school_ids      TEXT[]         -- Sedes donde aplica
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### Tabla: `combo_items`
```sql
id              UUID
combo_id        UUID           -- Referencia a combos
product_id      UUID           -- Referencia a products
quantity        INTEGER        -- Cantidad del producto en el combo
```

### Tabla: `promotions`
```sql
id              UUID
name            VARCHAR(200)   -- "Descuento Sándwiches"
description     TEXT           -- "Todos los sándwiches con 20% OFF"
discount_type   VARCHAR(20)    -- 'percentage' o 'fixed'
discount_value  DECIMAL(10,2)  -- 20.00 (para 20%) o 2.00 (para S/ 2.00)
applies_to      VARCHAR(20)    -- 'product', 'category', 'all'
target_ids      TEXT[]         -- IDs de productos o categorías
active          BOOLEAN
valid_from      DATE
valid_until     DATE
school_ids      TEXT[]
priority        INTEGER        -- Para resolver conflictos (mayor = prioridad)
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

---

## 🎨 Interfaz de Usuario

### Pestaña COMBOS
**Botón: "Crear Combo"**

**Wizard de 3 Pasos:**

#### Paso 1: Información Básica
- Nombre del combo
- Descripción

#### Paso 2: Seleccionar Productos
- Botón "Agregar Producto" para añadir filas
- Cada fila tiene:
  - Selector de producto (con indicador de stock 📦)
  - Campo de cantidad
  - Botón eliminar

#### Paso 3: Definir Precio
- Muestra el precio individual total
- Campo para ingresar precio del combo
- Calcula automáticamente el ahorro y % de descuento

**Vista de Lista:**
- Tarjetas visuales con:
  - Nombre y descripción
  - Precio grande y destacado
  - Lista de productos incluidos
  - Indicador de stock por producto
  - Badge de estado (Activo/Inactivo)
  - Botón para Activar/Desactivar

---

### Pestaña PROMOCIONES
**Botón: "Crear Promoción"**

**Formulario:**
- Nombre de la promoción
- Descripción
- Tipo de descuento: Porcentaje (%) o Monto Fijo (S/)
- Valor del descuento
- Aplica a: Producto / Categoría / Todos
- Selector múltiple para elegir productos o categorías
- Botón "Guardar Promoción"

**Vista de Lista:**
- Tarjetas con:
  - Nombre y descripción
  - Descuento destacado (20% o S/ 2.00)
  - A qué aplica (Producto, Categoría, Todos)
  - Badge de estado (Activa/Inactiva)
  - Botón para Activar/Desactivar

---

## ⚙️ Funciones SQL Incluidas

### 1. `get_active_combos_for_school(school_id)`
Obtiene todos los combos activos y vigentes para una sede específica, con sus productos incluidos.

**Uso:**
```sql
SELECT * FROM get_active_combos_for_school('uuid-de-sede');
```

**Retorna:**
```json
{
  "combo_id": "uuid",
  "combo_name": "Combo Estudiante",
  "combo_price": 5.00,
  "products": [
    {
      "product_id": "uuid",
      "product_name": "Sándwich Jamón",
      "quantity": 1,
      "has_stock": true,
      "price": 3.50
    },
    {
      "product_id": "uuid",
      "product_name": "Coca Cola 500ml",
      "quantity": 1,
      "has_stock": false,
      "price": 2.00
    }
  ]
}
```

---

### 2. `get_active_promotions_for_school(school_id)`
Obtiene todas las promociones activas y vigentes para una sede específica.

**Uso:**
```sql
SELECT * FROM get_active_promotions_for_school('uuid-de-sede');
```

---

### 3. `calculate_discounted_price(product_id, original_price, category, school_id)`
Calcula automáticamente el precio final de un producto aplicando la **mejor promoción disponible**.

**Uso:**
```sql
SELECT calculate_discounted_price(
  'uuid-producto',
  5.00,
  'sandwiches',
  'uuid-sede'
);
-- Retorna: 4.00 (si hay 20% descuento)
```

**Lógica:**
- Busca todas las promociones activas
- Aplica la promoción con mayor descuento
- Retorna el precio final (nunca menor a 0)

---

## 🔐 Permisos (RLS)

### Políticas de Seguridad

**Lectura (SELECT):**
- ✅ Todos los roles autenticados pueden VER combos/promociones

**Gestión (INSERT/UPDATE/DELETE):**
- ✅ Solo `admin_general` y `supervisor_red` pueden crear/modificar/eliminar

---

## 🚀 Cómo Ejecutar la Instalación

### 1. Ejecutar el Script SQL
```bash
1. Ir al Editor SQL de Supabase
2. Copiar y pegar el contenido de: SETUP_COMBOS_PROMOCIONES.sql
3. Ejecutar
```

**El script creará:**
- ✅ 3 tablas nuevas
- ✅ Índices para rendimiento
- ✅ Triggers para `updated_at`
- ✅ Políticas RLS
- ✅ 3 funciones SQL

---

### 2. Agregar el Módulo a la BD (Opcional)
Si quieres que aparezca en el sistema de permisos dinámicos:

```sql
INSERT INTO public.modules (code, name, description, icon, color, route, is_active)
VALUES (
  'promociones',
  'Combos y Promociones',
  'Crea combos especiales y descuentos',
  'TrendingUp',
  'pink',
  '/combos-promotions',
  true
);
```

---

## 🎯 Flujo de Uso Completo

### Caso de Uso 1: Crear un Combo "Lonchera Escolar"

**Paso 1:** Ir a Dashboard → "Combos y Promociones"

**Paso 2:** Click en "Crear Combo"

**Paso 3:** Llenar datos:
- Nombre: "Lonchera Escolar"
- Descripción: "Sándwich + Jugo + Galleta"

**Paso 4:** Agregar productos:
- Sándwich de Pollo x1
- Jugo Natural x1
- Galleta Oreo x1

**Paso 5:** Definir precio:
- Precio individual total: S/ 9.00
- Precio del combo: S/ 7.00
- Ahorro: S/ 2.00 (22% descuento)

**Paso 6:** Guardar → El combo queda ACTIVO

**Resultado:**
- Aparece en la lista de combos
- Listo para venderse en el POS

---

### Caso de Uso 2: Crear Promoción "Viernes de Sándwiches"

**Paso 1:** Ir a pestaña "Promociones"

**Paso 2:** Click en "Crear Promoción"

**Paso 3:** Llenar datos:
- Nombre: "Viernes de Sándwiches"
- Descripción: "Todos los sándwiches con 20% OFF"
- Tipo: Porcentaje (%)
- Valor: 20
- Aplica a: Categoría
- Seleccionar: "sandwiches"

**Paso 4:** Guardar → La promoción queda ACTIVA

**Resultado:**
- Todos los productos de categoría "sandwiches" tienen 20% descuento automáticamente
- Se aplica en tiempo real en el POS

---

## 🧪 Pruebas Recomendadas

### Prueba 1: Combo con Stock Mixto
1. Crear combo con:
   - Producto A (tiene stock)
   - Producto B (sin stock)
2. Vender 1 combo
3. Verificar:
   - ✅ Stock del Producto A disminuyó
   - ✅ Stock del Producto B no cambió

### Prueba 2: Promoción por Categoría
1. Crear promoción 30% en "bebidas"
2. Ir al POS
3. Agregar una bebida al carrito
4. Verificar que el precio se redujo 30%

### Prueba 3: Conflicto de Promociones
1. Crear promoción A: 10% en TODO
2. Crear promoción B: 25% en "snacks"
3. Agregar un snack al carrito
4. Verificar que se aplique el **mayor descuento** (25%)

---

## 📈 Ventajas del Sistema

✅ **Combos:**
- Aumenta ticket promedio
- Facilita ventas rápidas
- Control inteligente de stock

✅ **Promociones:**
- Marketing flexible
- Impulsa categorías específicas
- Fácil activación/desactivación

✅ **Técnico:**
- Totalmente integrado con productos y POS
- RLS para seguridad
- Optimizado con índices
- Funciones SQL reutilizables

---

## 🛠️ Próximas Mejoras (Opcionales)

- [ ] Imagen de combo (upload de fotos)
- [ ] Reporte de combos más vendidos
- [ ] Programación automática de promociones (activar/desactivar por fecha)
- [ ] Límite de usos por promoción
- [ ] Código de cupón para promociones
- [ ] Integración con pasarelas de pago (descuentos en pagos online)

---

## 📞 Soporte

Si tienes dudas o necesitas ajustes:
1. Revisa esta guía
2. Verifica las tablas en Supabase
3. Consulta los logs en consola del navegador

---

**Versión:** 1.0  
**Fecha:** Enero 2026  
**Estado:** ✅ Funcional
