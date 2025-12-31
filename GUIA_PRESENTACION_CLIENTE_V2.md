# 📱 GUÍA COMPLETA - SISTEMA ERP LIMA CAFÉ 28
## Desarrollado por ARQUISIA

Estimado equipo de **Lima Café 28**,

Bienvenidos a la versión actualizada de su sistema ERP. Hemos optimizado el proceso de venta para que sea más rápido y profesional, y hemos reforzado la seguridad en el registro de padres.

**⚠️ NOTA ESPECIAL DE PRUEBAS:** Si detectan cualquier error durante el uso, les agradeceríamos mucho que nos envíen un **mensaje de voz (audio)** explicando qué pasó, acompañado de una **captura de pantalla (screenshot)**. Esto nos ayudará a dejar el sistema perfecto para el lanzamiento.

---

## 📋 ÍNDICE

1. [Registro e Ingreso (Padres)](#1-registro-e-ingreso-padres)
2. [Módulo de Punto de Venta (POS)](#2-módulo-de-punto-de-venta-pos)
3. [Flujo de Venta Rápida](#3-flujo-de-venta-rápida)
4. [Novedades Técnicas](#4-novedades-técnicas)
5. [Sugerencias para la Prueba](#5-sugerencias-para-la-prueba)
6. [Funcionalidades Pendientes](#6-funcionalidades-pendientes)

---

## 1. REGISTRO E INGRESO (PADRES)

### 🔗 Link de Registro - Sede Naciones Unidas (Nordic)
```
https://rubennaldos.github.io/parent-portal-connect/#/register?school=NRD
```

### 📝 Proceso de Onboarding (Obligatorio):
Para garantizar la seguridad de los niños, el sistema ahora exige completar dos pasos antes de entrar al panel principal:

1.  **Paso 1: Datos del Padre**: Al registrarse (con Email o Google), el sistema le pedirá sus datos reales: DNI, Teléfono y Dirección.
2.  **Paso 2: Registro de Hijos**: Deberá registrar al menos a un estudiante indicando su Grado y Sección.
3.  **Acceso Directo**: Una vez completado, el sistema nunca más volverá a pedir estos datos.

> **💡 Prueba de Google Login:** Les pedimos probar especialmente el botón **"Continuar con Google"**. Si les sale un error, por favor repórtenlo de inmediato con captura de pantalla.

---

## 2. MÓDULO DE PUNTO DE VENTA (POS)

Hemos rediseñado el POS inspirándonos en sistemas de comida rápida para que la atención sea ágil.

### 🔐 Credenciales de Acceso (Usuario de Prueba):
*   **Usuario:** `cajeronordic@limacafe28.com`
*   **Contraseña:** `123456`
*   **Link:** `https://rubennaldos.github.io/parent-portal-connect/#/pos`

### 🛒 La Pantalla de Venta (3 Zonas):
*   **ZONA 1 (Izquierda)**: Categorías verticales (Bebidas, Snacks, Menú). 
*   **ZONA 2 (Centro)**: Tarjetas de productos con nombres grandes.
*   **ZONA 3 (Derecha)**: El Carrito. Muestra el nombre del niño y su **Saldo en Grande**.

---

## 3. FLUJO DE VENTA RÁPIDA

Para no perder tiempo con ventanas adicionales, ahora tienen dos botones directos tras pulsar **COBRAR**:

1.  **✅ Confirmar y Continuar (Botón Verde)**: Procesa la venta, descuenta el saldo y regresa al inicio para atender al siguiente alumno de inmediato.
2.  **🖨️ Confirmar e Imprimir (Botón Azul)**: Procesa la venta y abre la ventana para imprimir el ticket térmico.

---

## 4. NOVEDADES TÉCNICAS

*   **Reinicio Automático**: Después de cada venta, el sistema regresa solo a la pantalla de "Seleccionar Alumno/Genérico".
*   **Correlativos Únicos**: Cada cajero genera su propia serie (ej: `FN1-001`, `FN1-002`).
*   **SuperAdmin**: Ahora existe una pestaña de **"Estudiantes"** para ver a todos los alumnos registrados por colegio.

---

## 5. SUGERENCIAS PARA LA PRUEBA ✅

Para ayudarnos a encontrar posibles fallos, les sugerimos realizar estas acciones:

1.  **Registro con Google**: Intenten crear una cuenta de padre usando el botón de Google.
2.  **Completar Onboarding**: Registren sus datos y al menos un hijo de prueba.
3.  **Venta a Alumno**: Entren al POS con el usuario `cajeronordic@limacafe28.com`, busquen al hijo que crearon y realicen una compra.
4.  **Verificación de Saldo**: Regresen al portal de padres y verifiquen que el saldo del niño se haya descontado correctamente y que aparezca la compra en el historial.
5.  **Cliente Genérico**: En el POS, prueben hacer una venta usando el botón "Cliente Genérico" y seleccionen un método de pago (Yape/Efectivo).
6.  **Prueba de Impresión**: Pulsen "Confirmar e Imprimir" y verifiquen que se genere el formato de ticket de 80mm.

---

## 6. FUNCIONALIDADES PENDIENTES

1.  **🧾 Boletas/Facturas (SUNAT)**: En desarrollo para la Fase 2.
2.  **QR de Identificación**: Reemplazará la búsqueda por nombre.
3.  **Módulo de Alergias**: Alertas automáticas al vender productos prohibidos.

---

### 👨‍💻 SOPORTE ARQUISIA
Recuerden: **Captura de pantalla** + **Audio** con cualquier detalle.

**¡Gracias por ayudarnos a construir el mejor sistema para Lima Café 28!** 🚀

---
**Fecha:** 31 de Diciembre, 2025
**Empresa:** ARQUISIA ERP
**Versión:** 1.0.5 BETA

