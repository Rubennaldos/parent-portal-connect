# Fase 0 — Contrato y puntos de escritura: disponibilidad vs precios por sede

**Objetivo:** documentar el estado real del código y del esquema referido en el repo, y listar **todos** los sitios que modifican datos relacionados, para las fases siguientes (reglas en BD, RPC atómico, UI unificada).

**Nota sobre `docs/db_schema.sql`:** el archivo de referencia del esquema en este proyecto **no enumera** tablas `products` ni `product_school_prices`. Los nombres de columnas siguientes se toman de **`SETUP_PRECIOS_POR_SEDE.sql`**, migraciones SQL y del código TypeScript que las consume.

---

## 1. Contrato de datos (tal como aparece en el repo)

### 1.1 Tabla `products` — “disponibilidad comercial por alcance de sedes”

- Campo central para **en qué sedes se considera el producto del catálogo (ámbito)**: **`school_ids`** (tipo en práctica: arreglo de UUIDs de `schools`, o **`NULL`**).
- **Semántica usada en el frontend** (`src/pages/Products.tsx`):
  - **`school_ids = null`**: producto **global** — aplica a **todas** las sedes (en listados se usa `.or('school_ids.is.null,school_ids.cs.{...}')`).
  - **`school_ids = [...]`**: solo esas sedes.
- Otros flags relevantes para visibilidad en venta (no sustituyen al alcance por sede):
  - **`active`** — activación global del producto (POS/listados).
  - **`stock_control_enabled`**, registros en **`product_stock`** — control operativo por sede (otro módulo en `Products.tsx`).

### 1.2 Tabla `product_school_prices` — precio y “disponible en esta sede”

Definición base en **`SETUP_PRECIOS_POR_SEDE.sql`**:

| Columna        | Rol |
|----------------|-----|
| `product_id`   | FK a `products` |
| `school_id`    | FK a `schools` |
| `price_sale`   | Precio de venta en esa sede |
| `price_cost`   | Opcional |
| `is_available` | **“Permite deshabilitar un producto en una sede específica aunque esté activo globalmente.”** (comentario en SQL) |
| Restricción    | **`UNIQUE (product_id, school_id)`** |

**Duplicidad semántica:** la “disponibilidad” aparece en **dos niveles**:

1. **Alcance:** `products.school_ids` (¿esta sede entra en el catálogo del producto?).
2. **Por sede:** `product_school_prices.is_available` (¿en una sede concreta se puede vender si ya hay matriz de precios?).

El POS (`src/lib/productPricing.ts`) usa el precio personalizado y, si existe fila en `product_school_prices`, puede sustituir el flag efectivo **`active`** por **`is_available`** de esa fila.

---

## 2. Lectores relevantes (no escriben; definen el contrato funcional)

| Componente | Comportamiento |
|------------|----------------|
| `src/lib/productPricing.ts` | Lista productos por sede según `school_ids`; aplica `product_school_prices` y filtra con `p.active` al final. |
| `src/pages/POS.tsx` | Consume productos ya resueltos por `getProductsForSchool` (no redefine el contrato). |
| `src/pages/Products.tsx` — `fetchProductSchoolPrices` | Solo **lectura** de `product_school_prices` para la sede del usuario (mapeo `product_id → price_sale` en UI). |

---

## 3. Escritores / mutadores (inventario exhaustivo en `src` y RPC)

### 3.1 `src/pages/Products.tsx`

| Operación | Tabla | Qué hace |
|-----------|--------|----------|
| `handleSaveProduct` | **`products`** | `insert` / `update` con **`school_ids`** según `productScope`, `applyToAllSchools` y rol. **No** modifica `product_school_prices` en la misma acción. |
| `handleSaveStockControl` | `products`, `product_stock` | Afecta stock, no precios por sede. |
| `handleToggleActive` | **`products`** | Solo `active`. |
| `handleDeleteProduct` | **`products`** | `delete` (y en UI optimista `active`/`is_active`). |
| Otras rutinas (categorías, etc.) | varias | No tocan `product_school_prices`. |

### 3.2 `src/components/products/PriceMatrix.tsx`

| Operación | Tabla | Qué hace |
|-----------|--------|----------|
| `handleSaveAll` | **`product_school_prices`** | Para **admin_general**: **`delete`** de **todas** las filas del `product_id`, luego **`insert`** de un arreglo derivado del estado local (solo filas “custom” o con `!is_available`). Para **gestor con sede**: `delete` solo de su `school_id`, luego `insert` equivalente. |

**Implicación:** persistencia de precios **desacoplada** del wizard de `school_ids` en `Products.tsx`. Orden **delete → insert** en dos requests HTTP separados (no transacción única desde el cliente).

### 3.3 `src/components/products/BulkProductUpload.tsx`

| Operación | Tabla | Qué hace |
|-----------|--------|----------|
| `saveAll` | **`products`** | `insert` masivo con **`school_ids`**: si “todas las sedes”, rellena con **todos los IDs**; si no, **`[]`**. **No** escribe `product_school_prices`. |

**Riesgo de consistencia:** un arreglo vacío `[]` **no** es lo mismo que **`NULL`** en la semántica “global” documentada en el wizard principal; puede generar productos **sin alcance** si la BD trata `[]` distinto de `null` (a validar en PostgreSQL).

### 3.4 `merge_products` (PostgreSQL)

**Archivo:** `supabase/migrations/20260322_merge_products_rpc.sql`

- **Inserta** un producto nuevo con **`school_ids`** = unión (`DISTINCT`) de los `school_ids` de los productos fusionados (sobre `unnest`; si los viejos tenían `NULL`, hay que comprobar comportamiento real en BD).
- **Inserta/actualiza** `product_school_prices` desde el JSON `p_school_prices` (solo `price_sale` en el `INSERT` explícito; conflicto actualiza `price_sale`).
- **No** destruye historial de ventas en ítems; **desactiva** productos viejos.

### 3.5 `src/components/logistics/ProductLogisticsModal.tsx`

- **`update`** en **`products`** de campos logísticos (`family_id`, `subfamily_id`, `moq`, `min_stock`). **No** toca `school_ids` ni `product_school_prices`.

### 3.6 Otros

- **`scripts/`**: sin referencias encontradas a `product_school_prices` o inserciones de `products`.
- **Migraciones posteriores** (p. ej. `20260403_*`): leen `product_school_prices` en funciones de venta/POS; no se listan aquí como escritores operativos del catálogo desde la app.

---

## 4. Mapa de redundancia e inconsistencia actual

| Fenómeno | Detalle |
|----------|---------|
| **Dos “disponibilidades”** | Alcance `products.school_ids` vs switch **`is_available`** en `product_school_prices`. |
| **Dos flujos de guardado** | Wizard guarda solo `products`; matriz de precios guarda solo `product_school_prices` (y admin hace wipe por producto). |
| **Orden no atómico** | Cambiar sedes en el wizard **no** limpia ni alinea filas de precios; guardar matriz **no** actualiza `school_ids`. |
| **Wipe agresivo (admin)** | `PriceMatrix` borra **todos** los precios del producto y reinserta; si falla el segundo paso, estado intermedio peligroso. |

---

## 5. Riesgos de “doble escritura” y efectos colaterales

1. **Precio en sede fuera de `school_ids`:** posible hoy: existe fila en `product_school_prices` para sede B pero el producto tiene alcance solo en sede A (o `school_ids` recortado en el wizard sin tocar la matriz).
2. **Producto “global” (`school_ids` null) + matriz parcial:** filas en `product_school_prices` solo en algunas sedes; el resto usa precio base y comportamiento por defecto de `is_available` (según join en `getProductPriceForSchool` / listado masivo).
3. **Carga masiva sin matriz:** productos nuevos solo con `school_ids`; precios por sede pueden no existir hasta que alguien abra `PriceMatrix`.
4. **Fusión:** nuevo producto hereda unión de sedes y recibe precios desde UI; si `p_school_prices` no cubre todas las sedes de la unión, queda la misma asimetría que en el flujo manual.
5. **Borrado físico de producto:** `ON DELETE CASCADE` en `product_school_prices` (según `SETUP_PRECIOS_POR_SEDE`) elimina precios; **no** entra en conflicto directo con REGLA #13 de deuda **si** la deuda no depende solo del catálogo — pero **sí** afecta si algún flujo de cobro exige join vivo al producto (a auditar en fase 4 del plan).

---

## 6. Entregables de la Fase 0 (este documento)

- [x] Contrato descrito para **`products.school_ids`** y **`product_school_prices`** según el repo.
- [x] Lista de **todos los puntos de escritura** localizados en **`src`** y RPC **`merge_products`**.
- [x] Riesgos explícitos de **doble fuente** y **operaciones no atómicas**.

**Próxima fase (1):** definir en PostgreSQL la regla de integridad (precio o `is_available` solo para sedes permitidas por el alcance del producto) y política ante retiro de sede (desactivar vs eliminar), alineado a REGLA #13 — **sin** tocar tablas de deuda.
