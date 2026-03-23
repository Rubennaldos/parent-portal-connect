# Orden de ejecución SQL — Logística y productos

Ejecuta **uno por uno** en Supabase → **SQL Editor** → **Run**.  
Espera a que cada uno termine en **Success** antes del siguiente.

---

## Paso 1 — Stock, proveedores y entradas

**Todo junto:** `20260322_logistics_stock_control.sql`

**O en 8 partes (mismo resultado), en este orden:**

| Orden | Archivo |
|------|---------|
| 1.1 | `PASO1_1_suppliers.sql` |
| 1.2 | `PASO1_2_product_stock.sql` |
| 1.3 | `PASO1_3_purchase_entries.sql` |
| 1.4 | `PASO1_4_purchase_entry_items.sql` |
| 1.5 | `PASO1_5_products_stock_flag.sql` |
| 1.6 | `PASO1_6_rpc_deduct_stock.sql` |
| 1.7 | `PASO1_7_rpc_increment_stock.sql` |
| 1.8 | `PASO1_8_indexes.sql` |

Crea: `suppliers`, `product_stock`, `purchase_entries`, `purchase_entry_items`, columna `stock_control_enabled`, RPCs `deduct_product_stock` e `increment_product_stock`.

---

## Paso 2 — Familias, UoM y Sello Verde (columnas en `products`)

**Archivo:** `20260322_product_master_architecture.sql`

Crea: `product_families`, `product_subfamilies`, `product_packaging` y columnas `is_verified`, `family_id`, `subfamily_id`, `moq`, `min_stock`.

**Importante:** el **Paso 3** usa `is_verified`. Si no corres este paso antes, `merge_products` fallará o quedará desactualizada.

---

## Paso 3 — Función de fusión de productos (con Sello Verde)

**Archivo:** `20260322_merge_products_rpc.sql`

Crea o reemplaza la función `merge_products` (inserta el producto nuevo con `is_verified = true`).

**Solo después** de haber corrido el **Paso 2**.

---

## Paso 4 (opcional) — Marcar productos ya fusionados antes

Si ya hiciste Match **antes** de tener la función con `is_verified`, corrige los que quieras:

```sql
-- Ejemplo: alfajores verificados manualmente
UPDATE products
SET is_verified = true
WHERE active = true
  AND name ILIKE '%alfajor%';

-- O por ID concreto:
-- UPDATE products SET is_verified = true WHERE id = 'uuid-aqui';
```

---

## Resumen rápido

| Orden | Archivo |
|------|---------|
| 1 | `20260322_logistics_stock_control.sql` |
| 2 | `20260322_product_master_architecture.sql` |
| 3 | `20260322_merge_products_rpc.sql` |
| 4 | (opcional) bloque `UPDATE` de arriba |

Si el **Paso 1** ya lo ejecutaste antes y dio OK, puedes saltarlo y empezar por el **2**.
