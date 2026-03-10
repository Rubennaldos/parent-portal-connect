# REPORTE EJECUTIVO — SEDE NORDIC
## Investigación: Desfase en Cierre de Caja
**Fecha del informe:** 8 de marzo de 2026
**Preparado por:** Sistema de auditoría interna

---

## CONCLUSIÓN PRINCIPAL

> **El sistema NO es el causante del desfase en el cierre de caja.**
> El bug técnico encontrado existía, pero no afectó el efectivo físico de la caja.
> El problema del cierre de caja es operativo (humano), no del sistema.

---

## 1. SOBRE EL BUG TÉCNICO ENCONTRADO

Se identificó un bug en la función de cálculo del cierre de caja. Al investigar su impacto real en el Nordic se encontró lo siguiente:

| Concepto | Resultado |
|----------|-----------|
| Total de ventas anuladas en el período | 95 transacciones |
| Monto total anulado | S/ 1,574.00 |
| De ese monto, ¿cuánto era en **efectivo físico**? | **S/ 0.00** |
| ¿El bug causó faltante de efectivo en caja? | **NO** |

**¿Por qué no afectó la caja?** Porque el 100% de las ventas anuladas en el Nordic fueron pagadas con **saldo de estudiantes** o **transferencia/crédito**, no con billetes físicos. El cierre de caja solo cuenta el dinero en efectivo — si no hubo efectivo involucrado, no hay impacto en la caja.

El bug sí infló los **totales del dashboard de ventas** en S/ 1,574.00 — es decir, el reporte de "ventas del día" mostraba un número mayor al real. Esto ya fue corregido.

---

## 2. ANÁLISIS DE LAS 95 VENTAS ANULADAS

### ¿Quién anuló qué?

| Responsable | Ventas anuladas | Monto | Rol |
|-------------|-----------------|-------|-----|
| Padres de familia (portal web) | 73 | S/ 1,321.00 | Padres |
| Angie (`angienrd@limacafe28.com`) | 22 | S/ 253.00 | Gestor de sede |
| **TOTAL** | **95** | **S/ 1,574.00** | — |

### Motivos registrados por Angie (22 anulaciones):
Los motivos registrados son todos legítimos y operativos:

| Motivo | Veces |
|--------|-------|
| Perfil por eliminar (Ezra Nash Arce) | 5 |
| Pedido duplicado | 2 |
| Error de precio / cambio de precio | 3 |
| Cuenta equivocada | 1 |
| Faltó al colegio | 1 |
| Cambio de pedido / producto | 2 |
| Otros | 8 |

**Evaluación:** Las anulaciones de Angie tienen motivos justificados, fecha y hora exacta, y razón escrita. No hay indicios de irregularidad.

### ¿Qué pasó el 5 de marzo? (39 anulaciones en un día)

El 5 de marzo hubo **34 transacciones de prueba** creadas por dos cuentas de testing:

| Cuenta | Alumno | Transacciones | Monto |
|--------|--------|---------------|-------|
| `pruebakinder@gmail.com` | "Prueba" | 18 | S/ 288.00 |
| `ampuero_linares_jorge@hotmail.com` | Lucas Ignacio Ampuero Cavana | 16 | S/ 256.00 |

Estas 34 transacciones fueron creadas entre las 8:47pm y 8:59pm del 5 de marzo — todas en menos de 10 minutos — pediendo almuerzos de fechas futuras (desde el 6 hasta el 27 de marzo). **Son claramente transacciones de testing/prueba del sistema**, no ventas reales. Fueron anuladas sin afectar la caja.

**Acción recomendada:** Revisar si las cuentas `pruebakinder@gmail.com` y `ampuero_linares_jorge@hotmail.com` deben tener acceso al sistema o si deben ser desactivadas.

---

## 3. SOBRE LAS 73 ANULACIONES "SIN FECHA / DESCONOCIDO"

Estas 73 anulaciones fueron realizadas por **padres de familia desde el portal web** al cancelar pedidos de almuerzo de sus hijos. El sistema no guardaba la fecha de cancelación en esos casos — esto ya fue corregido en el código.

Los motivos registrados incluyen: "No vino a clases", "Problemas de salud", "Pedido duplicado" — son cancelaciones normales y esperadas de padres.

---

## 4. ¿ENTONCES POR QUÉ NO CUADRA EL CIERRE DE CAJA?

Si el bug no causó el faltante, la causa está en uno o más de estos factores operativos:

### Causa más probable: Egresos de caja no registrados en el sistema

El sistema calcula la caja esperada así:
```
Caja esperada = Monto inicial + Efectivo de ventas + Ingresos - Egresos
```

Si el personal saca dinero de la caja (para comprar insumos, dar vuelto extra, etc.) **y no lo registra como egreso en el sistema**, la caja esperada será mayor a la real → faltante.

**Verificación sugerida:** Comparar los egresos registrados en el sistema con los gastos reales del día.

### Otras causas posibles:

| Causa | Señal de alerta |
|-------|-----------------|
| Error al contar billetes | Diferencias pequeñas (S/ 1–20) |
| Dar vueltos de más | Diferencias pequeñas y constantes |
| Ventas en efectivo cobradas pero no registradas en el sistema | Diferencias exactas coinciden con montos redondos |

---

## 5. DÍAS SIN CIERRE DE CAJA REGISTRADO

Se detectaron días con ventas donde **no existe un cierre de caja registrado** en el sistema:

| Fecha | Ventas en el sistema | Cierre registrado |
|-------|---------------------|-------------------|
| 7 de marzo 2026 | Sí | ❌ No |
| 5 de marzo 2026 (parte) | Sí | ❌ No (cierre parcial) |
| 1 de marzo 2026 | Sí | ❌ No |
| 17 de febrero 2026 | Sí | ❌ No |
| 16 de febrero 2026 | Sí | ❌ No |
| 12 de febrero 2026 | Sí | ❌ No |
| 11 de febrero 2026 | Sí | ❌ No |

**Esto es importante:** Si no se hace el cierre de caja al final del día, no queda registro oficial de cuánto había en caja. El personal puede alegar que el sistema "no guardó" el cierre cuando en realidad no lo realizaron.

---

## 6. RESUMEN PARA LA DUEÑA

| Pregunta | Respuesta |
|----------|-----------|
| ¿El sistema causó el faltante de caja? | **NO** — el bug no afectó el efectivo |
| ¿Hubo irregularidades en las anulaciones? | **NO** — todas tienen motivos justificados |
| ¿Hay indicios de robo en el sistema? | **NO se detectaron** en el análisis de datos |
| ¿El personal está registrando todos los egresos? | **Pendiente de verificar** — es la causa más probable |
| ¿Se están cerrando las cajas todos los días? | **NO** — hay 7 días sin cierre registrado |
| ¿El bug ya fue corregido? | **SÍ** — corregido el 8 de marzo 2026 |

---

## 7. RECOMENDACIONES INMEDIATAS

1. **Exigir que se cierren las cajas TODOS los días** — sin excepción. Los días sin cierre no tienen registro oficial.

2. **Capacitar al personal en registrar egresos** — cualquier dinero que salga de la caja (compras de insumos, vueltos, etc.) debe registrarse en el módulo "Movimientos de Caja" antes de cerrar.

3. **Revisar las cuentas de prueba** — `pruebakinder@gmail.com` hizo 18 transacciones de testing el 5 de marzo. Verificar si esa cuenta debe seguir activa.

4. **Comparar el historial de cierres con las ventas del día** — para los días sin cierre, verificar con el personal qué pasó con el efectivo.

5. **El sistema ya está corregido** — a partir de hoy, las ventas anuladas no se contarán en el cierre de caja.

---

*Auditoría realizada el 8 de marzo de 2026*
*Se revisaron 95 transacciones anuladas en 15 días de operación*
*El bug fue corregido en el código y base de datos*
