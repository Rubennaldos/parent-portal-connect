-- Verificar que los menús tengan categorías asignadas
SELECT 
  lm.id,
  lm.date,
  lm.main_course,
  lm.category_id,
  lc.name as category_name,
  (
    SELECT COUNT(*) 
    FROM lunch_category_addons 
    WHERE category_id = lm.category_id 
    AND is_active = true
  ) as addons_count
FROM lunch_menus lm
LEFT JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE lm.date >= CURRENT_DATE
ORDER BY lm.date
LIMIT 20;
