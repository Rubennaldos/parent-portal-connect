-- Bloque C: triggers
SELECT 
    trigger_name, 
    event_object_table AS table_name, 
    action_statement AS action, 
    action_timing AS timing,
    event_manipulation AS event
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
