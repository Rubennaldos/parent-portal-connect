-- Ver el school_id del Profesor 2
SELECT 
    id as teacher_id,
    full_name,
    school_id_1,
    school_id_2
FROM teacher_profiles
WHERE full_name ILIKE '%Profesor 2%';
