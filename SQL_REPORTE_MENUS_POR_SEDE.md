# 📊 Reporte de Menús por Sede - Lima Café 28

## SQL 1: Resumen General - ¿Qué sedes tienen menú y cuántos?

```sql
-- ============================================
-- RESUMEN: SEDES CON MENÚS Y CANTIDADES
-- ============================================
SELECT 
  s.code AS codigo_sede,
  s.name AS nombre_sede,
  COUNT(DISTINCT lc.id) AS total_categorias,
  COUNT(DISTINCT lm.id) AS total_menus_creados,
  COUNT(DISTINCT CASE WHEN lc.is_active = true THEN lc.id END) AS categorias_activas,
  COUNT(DISTINCT CASE WHEN lm.date >= CURRENT_DATE THEN lm.id END) AS menus_futuros
FROM schools s
LEFT JOIN lunch_categories lc ON s.id = lc.school_id
LEFT JOIN lunch_menus lm ON s.id = lm.school_id
GROUP BY s.id, s.code, s.name
ORDER BY s.code;
```

---

## SQL 2: Detalle Completo - ¿Qué tiene cada sede de menú?

```sql
-- ============================================
-- DETALLE: CATEGORÍAS Y MENÚS POR SEDE
-- ============================================
SELECT 
  s.code AS sede,
  s.name AS nombre_sede,
  lc.name AS categoria_menu,
  lc.target_type AS para_quien,
  lc.price AS precio_categoria,
  lc.is_active AS categoria_activa,
  COUNT(lm.id) AS cantidad_menus_en_categoria,
  STRING_AGG(
    DISTINCT CONCAT(
      lm.date::text, 
      ' - ', 
      COALESCE(lm.main_course, 'Sin segundo')
    ), 
    ' | '
    ORDER BY lm.date::text
  ) AS ejemplos_menus
FROM schools s
LEFT JOIN lunch_categories lc ON s.id = lc.school_id
LEFT JOIN lunch_menus lm ON lc.id = lm.category_id
GROUP BY s.id, s.code, s.name, lc.id, lc.name, lc.target_type, lc.price, lc.is_active
ORDER BY s.code, lc.display_order, lc.name;
```

---

## SQL 3: Vista Simplificada - Solo lo esencial

```sql
-- ============================================
-- VISTA SIMPLE: SEDE | CATEGORÍAS | MENÚS
-- ============================================
SELECT 
  s.code AS "Sede",
  s.name AS "Nombre",
  COALESCE(COUNT(DISTINCT lc.id), 0) AS "Categorías",
  COALESCE(COUNT(DISTINCT lm.id), 0) AS "Menús Totales",
  STRING_AGG(DISTINCT lc.name, ', ') AS "Tipos de Menú"
FROM schools s
LEFT JOIN lunch_categories lc ON s.id = lc.school_id AND lc.is_active = true
LEFT JOIN lunch_menus lm ON s.id = lm.school_id
GROUP BY s.id, s.code, s.name
ORDER BY s.code;
```

---

## SQL 4: Reporte Ejecutivo - Para la Dueña

```sql
-- ============================================
-- REPORTE EJECUTIVO - RESUMEN COMPLETO
-- ============================================
WITH resumen_sedes AS (
  SELECT 
    s.code,
    s.name,
    COUNT(DISTINCT lc.id) AS categorias,
    COUNT(DISTINCT lm.id) AS menus_totales,
    COUNT(DISTINCT CASE WHEN lm.date >= CURRENT_DATE THEN lm.id END) AS menus_futuros,
    STRING_AGG(DISTINCT lc.name, ' • ') AS tipos_menu
  FROM schools s
  LEFT JOIN lunch_categories lc ON s.id = lc.school_id AND lc.is_active = true
  LEFT JOIN lunch_menus lm ON s.id = lm.school_id
  GROUP BY s.id, s.code, s.name
)
SELECT 
  code AS "Código",
  name AS "Sede",
  categorias AS "Categorías",
  menus_totales AS "Menús Totales",
  menus_futuros AS "Menús Futuros",
  tipos_menu AS "Tipos de Menú Disponibles"
FROM resumen_sedes
ORDER BY code;
```

---

## SQL 5: Detalle de Menús con Platos

```sql
-- ============================================
-- DETALLE: MENÚS CON SUS PLATOS
-- ============================================
SELECT 
  s.code AS sede,
  lc.name AS categoria,
  lm.date AS fecha,
  lm.starter AS entrada,
  lm.main_course AS segundo,
  lm.beverage AS bebida,
  lm.dessert AS postre,
  lm.target_type AS para_quien
FROM schools s
INNER JOIN lunch_categories lc ON s.id = lc.school_id
INNER JOIN lunch_menus lm ON lc.id = lm.category_id
WHERE lm.date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY s.code, lm.date DESC, lc.name;
```

---

## 📋 Recomendación

**Para la dueña, usa el SQL 4 (Reporte Ejecutivo)** - Es el más claro y fácil de entender.

Si necesita más detalle, puede usar el SQL 2 o SQL 5.
