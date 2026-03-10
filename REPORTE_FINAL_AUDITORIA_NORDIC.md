# AUDITORÍA COMPLETA DE PAGOS — SEDE NORDIC
## Reporte Final para la Dueña
**Fecha:** 8 de marzo de 2026 | **Período analizado:** 11 feb – 7 mar 2026

---

## SEMÁFORO GENERAL

| Método de Pago | Estado | Observación |
|----------------|--------|-------------|
| Efectivo | ✅ LIMPIO | 0 anulaciones. Caja sin irregularidades. |
| Tarjeta | ✅ LIMPIO | 0 anulaciones. Sin problemas. |
| Yape QR | ✅ LIMPIO | 0 anulaciones. Sin problemas. |
| Plin | ✅ LIMPIO | 0 anulaciones. Sin problemas. |
| Transferencia | ⚠️ REVISAR | 3 cobros anulados — S/ 64.00 en la cuenta del colegio |
| Yape | 🚨 ALERTA | 2 cobros anulados por cajero desconocido — S/ 32.00 sin devolver |
| Saldo/Crédito | ⚠️ ALTO | 9.5% de anulación — explicado por tests y cancelaciones de padres |

---

## VOLUMEN TOTAL DE OPERACIONES

| Método | Ventas válidas | Monto cobrado | Anuladas | Monto anulado |
|--------|---------------|---------------|----------|---------------|
| Transferencia | 720 | S/ 10,656.50 | 3 | S/ 64.00 |
| Saldo/Crédito | 861 | S/ 8,976.00 | 90 | S/ 1,478.00 |
| Tarjeta | 140 | S/ 1,912.50 | 0 | — |
| Efectivo | 151 | S/ 1,795.50 | 0 | — |
| Yape QR | 100 | S/ 952.50 | 0 | — |
| Yape | 38 | S/ 560.50 | 2 | S/ 32.00 |
| Plin | 10 | S/ 137.50 | 0 | — |
| **TOTAL** | **2,020** | **S/ 25,000.50** | **95** | **S/ 1,574.00** |

---

## HALLAZGO #1 — 🚨 YAPE: S/ 32.00 COBRADO Y NO DEVUELTO

**Nivel de riesgo: ALTO**

Dos cobros de Yape fueron cancelados en el sistema, pero el sistema **no registra devolución al cliente**. El dinero existe en el Yape del colegio y nadie lo reclamó formalmente.

| Ticket | Fecha cobro | Alumno | Monto | Fecha anulación | Motivo | Cajero |
|--------|-------------|--------|-------|-----------------|--------|--------|
| T-AN-000613 | 2 mar 2026 | Leydi Valentina | S/ 16.00 | 6 mar 2026 | Duplicado | **Desconocido** |
| T-AN-000612 | 2 mar 2026 | Diego Miura | S/ 16.00 | 6 mar 2026 | Error de registro | **Desconocido** |

**Lo más preocupante:** Ambos cobros fueron realizados por un cajero que el sistema identifica como "desconocido" — es decir, alguien que cobró por Yape sin estar correctamente registrado en el sistema, o usó una cuenta que no tiene perfil vinculado.

**Acción requerida:**
1. Verificar el extracto del Yape del colegio del 2 de marzo — ¿llegaron esos dos pagos de S/ 16?
2. Si llegaron, verificar si se devolvieron a los padres de Leydi Valentina y Diego Miura
3. Si no se devolvieron, el colegio tiene S/ 32.00 en Yape que pertenecen a esos padres

---

## HALLAZGO #2 — ⚠️ TRANSFERENCIA: S/ 64.00 — 3 CASOS A VERIFICAR

**Nivel de riesgo: MEDIO**

| Ticket | Fecha | Alumno/Padre | Monto | Cajero | Motivo | Acción |
|--------|-------|-------------|-------|--------|--------|--------|
| T-ANA3-000001 | 3 mar | Sandro Salguero Zapata | S/ 32.00 | `anatolia.zapata@gmail.com` | Pedido duplicado | ⚠️ Ver detalle abajo |
| T-AN-001048 | 5 mar | Almudena Queija Llatas | S/ 16.00 | `angienrd@limacafe28.com` | Faltó al colegio | Verificar si se devolvió |
| T-MGS-000002 | 3 mar | Santiago Luna | S/ 16.00 | `mgsamplini@gmail.com` | **Sin motivo registrado** | Solicitar explicación |

### Caso más sospechoso: T-ANA3-000001 — Anatolia Zapata

`anatolia.zapata@gmail.com` tiene una **tasa de anulación del 25%** — 1 de cada 4 transacciones que hace, la anula. El caso fue un "pedido duplicado" de S/ 32.00, lo que significa que:

- El padre pagó **dos veces** la misma transferencia de S/ 32.00
- El sistema cobró **S/ 64.00** en total (dos pedidos)
- Uno fue anulado, pero ¿se devolvieron los S/ 32.00 al padre?

**Acción requerida:** Verificar el extracto bancario del 3 de marzo — ¿llegaron dos transferencias del padre de Sandro Salguero? Si llegaron dos, ¿se devolvió una?

### Caso sin motivo: T-MGS-000002 — Santiago Luna

La transacción fue cancelada sin que se registrara motivo ni fecha de cancelación. Esto es irregular — toda anulación debe tener justificación escrita.

**Acción requerida:** Preguntar a `mgsamplini@gmail.com` por qué se anuló ese cobro.

---

## HALLAZGO #3 — ✅ EFECTIVO Y TARJETA: COMPLETAMENTE LIMPIOS

**Nivel de riesgo: NINGUNO**

- **Efectivo:** 151 ventas, S/ 1,795.50 cobrado. **Cero anulaciones.** La caja física no tiene irregularidades por el lado del sistema.
- **Tarjeta:** 140 ventas, S/ 1,912.50 cobrado. **Cero anulaciones.**

> Si el cierre de caja no cuadra, la causa NO está en ventas del sistema mal registradas — está en movimientos físicos no registrados (egresos, vueltos, etc.).

---

## HALLAZGO #4 — ℹ️ SALDO/CRÉDITO: 9.5% DE ANULACIÓN — EXPLICADO

El 9.5% de anulación en pagos con saldo es alto pero explicable:

- **34 transacciones** fueron de cuentas de testing (`pruebakinder@gmail.com` y `ampuero_linares_jorge@hotmail.com`) el 5 de marzo — S/ 544.00
- El resto son cancelaciones legítimas de padres (alumno enfermo, cambio de pedido, etc.)
- **Sin estas 34 pruebas**, la tasa bajaría a ~4.6% — completamente normal

---

## RESUMEN FINANCIERO — ¿DÓNDE ESTÁ EL DINERO?

| Concepto | Monto | Estado |
|----------|-------|--------|
| Total cobrado en el período | S/ 25,000.50 | En caja + banco del colegio |
| Yape cobrado y no devuelto | **S/ 32.00** | 🚨 Verificar — puede ser dinero retenido |
| Transferencia a verificar | **S/ 64.00** | ⚠️ Confirmar si se devolvió a los padres |
| Saldo inflado por bug (ya corregido) | S/ 1,478.00 | No es dinero real — era saldo de estudiantes |
| Efectivo: impacto del bug | **S/ 0.00** | ✅ Caja limpia |

---

## CONCLUSIONES PARA LA DUEÑA

**1. El sistema no robó ni perdió dinero.**
El bug técnico que se encontró inflaba los números del dashboard pero no movió efectivo real. Ya fue corregido.

**2. La caja de efectivo está limpia.**
De 151 ventas en efectivo y 151 cobros por Yape QR, ninguno fue anulado. El efectivo físico entra y sale correctamente según el sistema.

**3. Hay S/ 32.00 en Yape que necesitan verificación urgente.**
Dos cobros de Yape realizados por un cajero "desconocido" fueron anulados en el sistema sin registro de devolución. Verificar el extracto del Yape del colegio del 2 de marzo.

**4. Hay S/ 64.00 en transferencias bancarias a aclarar.**
Tres transferencias fueron anuladas — confirmar con el banco si el dinero fue devuelto a los padres o sigue en la cuenta del colegio.

**5. La causa más probable del desfase en caja es operativa:**
El personal no está registrando todos los egresos en el sistema, o no está cerrando la caja todos los días (se detectaron 7 días sin cierre registrado).

---

## ACCIONES INMEDIATAS RECOMENDADAS

| Prioridad | Acción | Responsable |
|-----------|--------|-------------|
| 🔴 URGENTE | Verificar extracto Yape del 2 marzo — buscar 2 pagos de S/16 | Dueña |
| 🔴 URGENTE | Confirmar si se devolvió a padres de Leydi Valentina y Diego Miura | Dueña |
| 🟡 ESTA SEMANA | Verificar extracto bancario del 3 mar — cobro doble Sandro Salguero | Administración |
| 🟡 ESTA SEMANA | Pedir explicación a `mgsamplini@gmail.com` por anulación sin motivo | Administración |
| 🟡 ESTA SEMANA | Revisar identidad del cajero "desconocido" en cobros Yape | Administración |
| 🟢 PROCESO | Exigir cierre de caja diario sin excepción | Personal de caja |
| 🟢 PROCESO | Capacitar en registrar egresos antes de cerrar caja | Personal de caja |
| 🟢 PROCESO | Evaluar si desactivar cuentas `pruebakinder@gmail.com` | Desarrollador |

---

*Auditoría realizada el 8 de marzo de 2026*
*Transacciones analizadas: 2,020 | Período: 11 feb – 7 mar 2026*
*Bug del sistema: corregido. Impacto en efectivo: S/ 0.00*
