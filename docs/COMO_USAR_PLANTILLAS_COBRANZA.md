# Cómo usar las plantillas de cobranza (WhatsApp)

## ¿Qué son?

Son el texto que se copia cuando haces clic en "Copiar Mensaje" en la pestaña Cobrar. Tú escribes el mensaje **una sola vez** y el sistema reemplaza automáticamente los datos de cada persona (nombre, monto, etc.).

---

## Tres plantillas

Puedes tener **tres mensajes distintos**:

1. **Todo** — cuando el deudor tiene almuerzos y cafetería (o no quieres diferenciar).
2. **Almuerzos** — solo para cobrar almuerzos.
3. **Cafetería** — solo para cobrar consumos de cafetería.

Si no escribes nada en "Almuerzos" o "Cafetería", se usará la plantilla "Todo" al copiar ese tipo.

---

## Las variables (lo importante)

En lugar de poner el nombre a mano, escribes una **palabra entre llaves**. El sistema la cambia por el dato real.

| Escribes esto      | El sistema lo cambia por                    |
|--------------------|---------------------------------------------|
| `{destinatario}`   | A quien va el mensaje (papá/mamá o el profe/cliente) |
| `{nombre}`         | Nombre del deudor (alumno, profe o cliente) |
| `{monto}`          | Monto a cobrar (según el tipo que copies)   |
| `{periodo}`        | Período de cobro (ej. Semana 1-5 Enero)     |
| `{monto_almuerzo}` | Solo monto de almuerzos                     |
| `{monto_cafeteria}`| Solo monto de cafetería                     |
| `{numero_cuenta}`  | Número de cuenta (si lo configuraste)        |
| `{numero_yape}`    | Número Yape (si lo configuraste)             |
| `{numero_plin}`    | Número Plin (si lo configuraste)             |

---

## Ejemplo de plantilla que sirve para todos (alumnos y profesores)

```
Estimado(a) {destinatario}

*{nombre}* tiene un consumo pendiente.

Monto: S/ {monto}

Para pagar, contacte con administración.
Gracias.
```

- Si es **alumno**: el mensaje va al padre y habla del alumno.
- Si es **profesor** o **cliente**: el mensaje va a esa persona y habla de ella.

**No tienes que cambiar el mensaje** según sea alumno o profesor: `{destinatario}` y `{nombre}` se adaptan solos.

---

## Pasos rápidos

1. Entra a **Cobranzas** → pestaña **Configuración**.
2. Elige la sede (si ves varias).
3. En "Plantillas de Mensaje WhatsApp" elige la pestaña: **Todo**, **Almuerzos** o **Cafetería**.
4. Escribe tu mensaje y donde quieras el nombre o monto, pon la variable (ej. `{destinatario}`, `{nombre}`, `{monto}`).
5. Haz clic en **Guardar las 3 plantillas**.
6. En la pestaña **Cobrar**, al hacer "Copiar Mensaje" (o elegir Almuerzos/Cafetería/Todo en el desplegable), se usará la plantilla que corresponda y se reemplazarán las variables con los datos reales.

---

## Resumen en una frase

**Escribes el mensaje una vez usando {destinatario}, {nombre}, {monto}, etc.; el sistema rellena esos huecos con los datos de cada deudor cuando copias el mensaje.**
