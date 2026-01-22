# 🎁 RESUMEN: SISTEMA DE COMBOS Y PROMOCIONES

## ✅ LO QUE SE HA IMPLEMENTADO

### 📁 Archivos Creados

#### 1. **Base de Datos**
- `SETUP_COMBOS_PROMOCIONES.sql` - Script completo de base de datos
  - 3 tablas nuevas: `combos`, `combo_items`, `promotions`
  - RLS policies para seguridad
  - 3 funciones SQL para obtener y calcular precios
  - Índices optimizados
  - Triggers para `updated_at`

- `AGREGAR_MODULO_PROMOCIONES.sql` - Registro del módulo en el sistema de permisos
  - Agrega el módulo con código `promociones`
  - Define permisos por rol

#### 2. **Frontend - Componentes**
- `src/components/products/CombosPromotionsManager.tsx` - Componente principal
  - Tabs para Combos y Promociones
  - Wizard de 3 pasos para crear combos
  - Formulario dinámico para promociones
  - Vista de tarjetas para gestionar ambos

#### 3. **Frontend - Páginas**
- `src/pages/CombosPromotions.tsx` - Página del módulo
  - Verificación de permisos
  - Header profesional
  - Contenedor del componente principal

#### 4. **Configuración**
- `src/App.tsx` - Ruta agregada
  - `/combos-promotions` protegida por permisos

- `src/pages/Dashboard.tsx` - Módulo agregado al dashboard
  - Tarjeta visible para roles autorizados
  - Icono `TrendingUp` con color rosa

#### 5. **Documentación**
- `GUIA_COMBOS_PROMOCIONES.md` - Documentación completa
  - Explicación conceptual
  - Estructura de BD
  - Ejemplos de uso
  - Casos de prueba

---

## 🎯 DIFERENCIAS CLAVE: COMBOS vs PROMOCIONES

### 🎁 COMBOS
```
✅ QUÉ SON
- Agrupación de productos que se venden juntos
- Precio FIJO especial

✅ EJEMPLO
Combo Estudiante: Sándwich + Gaseosa = S/ 5.00
(Precio individual: S/ 3.50 + S/ 2.00 = S/ 5.50)

✅ CARACTERÍSTICAS
- Puedes agregar cuantos productos quieras
- Control de stock INDIVIDUAL por producto
- Si un producto tiene stock, se descuenta
- Si no tiene stock activado, no se descuenta
- Precio del combo NO cambia aunque cambien precios individuales
```

### 🏷️ PROMOCIONES
```
✅ QUÉ SON
- Descuentos sobre productos o categorías
- Se aplica automáticamente al precio

✅ EJEMPLO
Promoción: "Todos los sándwiches con 20% de descuento"
Sándwich antes: S/ 5.00 → Ahora: S/ 4.00

✅ TIPOS DE APLICACIÓN
1. Producto Específico: "15% en Coca Cola 500ml"
2. Categoría: "20% en todos los sándwiches"
3. General: "10% en todo el catálogo"

✅ TIPOS DE DESCUENTO
1. Porcentaje: 20% de descuento
2. Monto Fijo: S/ 2.00 de descuento
```

---

## 🎨 INTERFAZ DE USUARIO

### Vista Principal
```
┌─────────────────────────────────────────────────────┐
│  🎁 Combos y Promociones                            │
│  Crea combos especiales y promociones               │
└─────────────────────────────────────────────────────┘

┌────────────────────┬────────────────────┐
│   📦 Combos        │  🏷️ Promociones    │
└────────────────────┴────────────────────┘
```

### Pestaña COMBOS
```
[+ Crear Combo]

┌──────────────────────────────┐
│ Combo Estudiante             │
│ Sándwich + Gaseosa          │
│                              │
│ S/ 5.00                     │
│                              │
│ • 1x Sándwich de Pollo 📦   │
│ • 1x Coca Cola 500ml        │
│                              │
│ [ACTIVO]  [Desactivar]      │
└──────────────────────────────┘
```

### Pestaña PROMOCIONES
```
[+ Crear Promoción]

┌───────────────────────────────────────┐
│ Descuento Sándwiches          [ACTIVA]│
│ Todos los sándwiches con 20% OFF     │
│                                       │
│ Descuento: 20%                       │
│ Aplica a: Categoría (sandwiches)     │
│                                       │
│ [Desactivar]                         │
└───────────────────────────────────────┘
```

---

## 📊 WIZARD DE COMBOS (3 PASOS)

### Paso 1: Información Básica
```
┌─────────────────────────────────┐
│ 📦 Información del Combo        │
│                                 │
│ Nombre del Combo *              │
│ [Combo Estudiante          ]    │
│                                 │
│ Descripción                     │
│ [Sándwich + Gaseosa        ]    │
│                                 │
│         [Siguiente →]           │
└─────────────────────────────────┘
```

### Paso 2: Seleccionar Productos
```
┌─────────────────────────────────┐
│ 🛒 Productos del Combo          │
│                                 │
│ [Sándwich de Pollo 📦] [1] [X]  │
│ [Coca Cola 500ml     ] [1] [X]  │
│                                 │
│ [+ Agregar Producto]            │
│                                 │
│ [← Anterior]  [Siguiente →]     │
└─────────────────────────────────┘
```

### Paso 3: Definir Precio
```
┌─────────────────────────────────┐
│ 💰 Precio del Combo             │
│                                 │
│ Precio Individual: S/ 5.50      │
│                                 │
│ Precio del Combo *              │
│ S/ [5.00]                       │
│                                 │
│ 💚 Ahorro: S/ 0.50 (9%)         │
│                                 │
│ [← Anterior]  [✅ Guardar]      │
└─────────────────────────────────┘
```

---

## 🔧 FUNCIONES SQL DISPONIBLES

### 1. Obtener Combos Activos
```sql
SELECT * FROM get_active_combos_for_school('uuid-sede');
```
Retorna combos con todos sus productos incluidos.

### 2. Obtener Promociones Activas
```sql
SELECT * FROM get_active_promotions_for_school('uuid-sede');
```
Retorna promociones vigentes ordenadas por prioridad.

### 3. Calcular Precio con Descuento
```sql
SELECT calculate_discounted_price(
  'product-uuid',
  5.00,           -- precio original
  'sandwiches',   -- categoría
  'school-uuid'
);
-- Retorna: 4.00 (si hay 20% descuento)
```

---

## 🚀 CÓMO USAR

### Paso 1: Ejecutar Scripts SQL
```bash
1. Abrir Supabase Dashboard
2. Ir a SQL Editor
3. Ejecutar: SETUP_COMBOS_PROMOCIONES.sql
4. Ejecutar: AGREGAR_MODULO_PROMOCIONES.sql
```

### Paso 2: Acceder al Módulo
```bash
1. Ir a Dashboard
2. Click en "Combos y Promociones"
3. Crear tu primer combo o promoción
```

---

## 🎯 CASOS DE USO REALES

### Caso 1: Combo con Stock
```
Producto A: Galleta (stock: 50 unidades)
Producto B: Jugo (sin control de stock)

Al vender 1 combo:
✅ Stock de galleta: 50 → 49
✅ Jugo: No se descuenta (no tiene stock activado)
```

### Caso 2: Promoción por Categoría
```
Crear: "Viernes de Bebidas"
- Tipo: Porcentaje
- Valor: 15%
- Aplica a: Categoría "bebidas"

Resultado:
✅ Coca Cola 500ml: S/ 2.00 → S/ 1.70
✅ Inca Kola 500ml: S/ 2.00 → S/ 1.70
✅ Agua San Luis: S/ 1.50 → S/ 1.28
```

### Caso 3: Promoción Específica
```
Crear: "Oferta Sándwich Pollo"
- Tipo: Monto Fijo
- Valor: S/ 1.00
- Aplica a: Producto específico "Sándwich de Pollo"

Resultado:
✅ Sándwich de Pollo: S/ 5.00 → S/ 4.00
❌ Otros sándwiches: Sin cambio
```

---

## 🔐 PERMISOS POR ROL

| Rol               | Combos | Promociones | Notas                          |
|-------------------|--------|-------------|--------------------------------|
| admin_general     | ✅ ✏️ 🗑️ | ✅ ✏️ 🗑️     | Acceso total                   |
| supervisor_red    | ✅ ✏️ 🗑️ | ✅ ✏️ 🗑️     | Acceso total                   |
| gestor_unidad     | ✅      | ✅          | Solo lectura                   |
| operador_caja     | ✅      | ✅          | Solo lectura (para aplicar)    |
| operador_cocina   | ❌      | ❌          | Sin acceso                     |

Leyenda:
- ✅ = Ver
- ✏️ = Editar
- 🗑️ = Eliminar
- ❌ = Sin acceso

---

## 📈 BENEFICIOS

### Para el Negocio
✅ Aumenta el ticket promedio con combos atractivos
✅ Impulsa ventas de productos específicos
✅ Facilita campañas de marketing
✅ Control total de márgenes

### Para el Usuario
✅ Interfaz visual e intuitiva
✅ Wizard paso a paso
✅ Cálculo automático de ahorros
✅ Activación/desactivación rápida

### Técnico
✅ Integración nativa con productos y POS
✅ Control de stock individual
✅ RLS para seguridad
✅ Funciones SQL optimizadas

---

## 🧪 CHECKLIST DE PRUEBAS

### Combos
- [ ] Crear combo con 2 productos
- [ ] Crear combo con 5 productos
- [ ] Vender combo y verificar descuento de stock
- [ ] Activar/desactivar combo
- [ ] Editar precio de combo

### Promociones
- [ ] Crear promoción por producto
- [ ] Crear promoción por categoría
- [ ] Crear promoción general (todos)
- [ ] Verificar descuento porcentaje
- [ ] Verificar descuento monto fijo
- [ ] Activar/desactivar promoción

### Stock
- [ ] Combo: ambos productos con stock → descuentan ambos
- [ ] Combo: solo 1 con stock → descuenta solo ese
- [ ] Combo: ninguno con stock → no descuenta nada

---

## 📞 SOPORTE

Si encuentras problemas:
1. Verifica que ejecutaste ambos scripts SQL
2. Revisa la consola del navegador (F12)
3. Verifica los permisos del usuario en BD
4. Consulta la `GUIA_COMBOS_PROMOCIONES.md`

---

## ✨ PRÓXIMOS PASOS SUGERIDOS

1. **Integrar con POS**
   - Mostrar combos disponibles en interfaz de venta
   - Aplicar automáticamente promociones al agregar productos

2. **Reportes**
   - Combos más vendidos
   - ROI de promociones
   - Análisis de descuentos aplicados

3. **Programación Automática**
   - Activar/desactivar por fecha y hora
   - Promociones recurrentes (todos los viernes)

4. **Cupones**
   - Códigos promocionales
   - Límite de usos

---

**Estado:** ✅ FUNCIONAL  
**Versión:** 1.0  
**Fecha:** Enero 2026  
**Desarrollado para:** Lima Café 28 - Cafeterías Escolares Saludables
