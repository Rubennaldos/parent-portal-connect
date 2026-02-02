# 🔧 FIX: Pedidos de Profesores No Aparecen por Sede

**Fecha:** 2 de Febrero, 2026  
**Componente:** `src/pages/LunchOrders.tsx`

---

## ❌ PROBLEMA

Los **pedidos de profesores** no aparecían cuando el **admin de sede** filtraba por su escuela (ej: Jean LeBouch). Solo aparecían los pedidos de alumnos.

---

## 🔍 CAUSA

El filtro por sede **solo consideraba** `student.school_id`, pero los **profesores** tienen su sede en `teacher_profiles.school_id_1`, por lo que quedaban excluidos del filtro.

### Código Problemático:

```tsx
// ❌ Solo filtraba estudiantes
if (selectedSchool !== 'all') {
  filtered = filtered.filter(order => 
    order.student?.school_id === selectedSchool
  );
}
```

---

## ✅ SOLUCIÓN

### 1. **Agregar `school_id_1` al Query de Profesores:**

```tsx
teacher:teacher_profiles!lunch_orders_teacher_id_fkey (
  full_name,
  school_id_1  // ✅ AGREGADO
)
```

### 2. **Actualizar Interface TypeScript:**

```tsx
interface LunchOrder {
  // ...
  student?: {
    full_name: string;
    photo_url: string | null;
    is_temporary: boolean;
    temporary_classroom_name: string | null;
    school_id: string;  // ✅ school_id del estudiante
  };
  teacher?: {
    full_name: string;
    school_id_1: string;  // ✅ AGREGADO: school_id del profesor
  };
}
```

### 3. **Actualizar Filtro por Sede:**

```tsx
const filterOrders = () => {
  let filtered = [...orders];

  if (selectedSchool !== 'all') {
    filtered = filtered.filter(order => {
      // ✅ Incluir pedidos de estudiantes de la sede
      if (order.student?.school_id === selectedSchool) return true;
      
      // ✅ NUEVO: Incluir pedidos de profesores de la sede
      if (order.teacher?.school_id_1 === selectedSchool) return true;
      
      return false;
    });
  }
  
  // ... resto de filtros
};
```

---

## 📊 LÓGICA DE FILTRADO

| Tipo de Pedido | Campo de Sede       | Incluido si... |
|----------------|---------------------|----------------|
| **Alumno**     | `student.school_id` | Coincide con sede seleccionada |
| **Profesor**   | `teacher.school_id_1` | Coincide con sede seleccionada |
| **Temporal**   | `student.school_id` | Coincide con sede seleccionada |

---

## 🧪 PRUEBA

1. Inicia sesión como **admin de Jean LeBouch**
2. Ve a **Gestión de Pedidos**
3. Verifica que aparezcan:
   - ✅ Pedidos de **alumnos** de Jean LeBouch
   - ✅ Pedidos de **profesores** de Jean LeBouch (ej: `profesorjbl@limacafe28.com`)
   - ❌ Pedidos de otras sedes (si es gestor de una sola sede)

---

## ✅ RESULTADO

- ✅ **Pedidos de profesores ahora visibles** para admins de sede
- ✅ **Filtro por sede funciona correctamente** para ambos tipos
- ✅ **Sin errores de TypeScript**
- ✅ **Hot Reload aplicado automáticamente**

---

**🎉 ¡AHORA LOS ADMINS DE SEDE PUEDEN VER LOS PEDIDOS DE SUS PROFESORES!**
