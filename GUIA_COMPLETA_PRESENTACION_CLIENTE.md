# 📱 GUÍA COMPLETA - SISTEMA ERP LIMA CAFÉ 28
## Desarrollado por ARQUISIA

---

Estimado equipo de **Lima Café 28**,

Bienvenidos a su nuevo sistema ERP diseñado específicamente para la gestión de kioscos escolares. Esta guía les ayudará a probar y familiarizarse con todas las funcionalidades del sistema.

Si tienen alguna pregunta o sugerencia durante las pruebas, no duden en contactarme. Estoy aquí para ayudarles. 😊

---

## 📋 ÍNDICE

1. [Registro e Ingreso como Padre/Apoderado](#1-registro-e-ingreso-como-padreapoderado)
2. [Panel de Padres - Funcionalidades](#2-panel-de-padres---funcionalidades)
3. [Módulo de Punto de Venta (POS)](#3-módulo-de-punto-de-venta-pos)
4. [Funcionalidades Pendientes](#4-funcionalidades-pendientes)
5. [Contacto y Soporte](#5-contacto-y-soporte)

---

## 1. REGISTRO E INGRESO COMO PADRE/APODERADO

### 🔗 Link de Registro - Sede Naciones Unidas (Nordic)

```
https://rubennaldos.github.io/parent-portal-connect/#/register?school=NRD
```

> **NOTA IMPORTANTE:** Este link actualmente se ingresa manualmente, pero en la versión final se convertirá en un **código QR** que podrán escanear fácilmente con su celular. Por ahora, pueden copiarlo y pegarlo en el navegador.

### 📝 Pasos para Registrarse:

1. **Copiar y pegar** el link en su navegador (Chrome, Safari, etc.)

2. **Rellenar el formulario** con sus datos:
   - Nombre completo del apoderado
   - Correo electrónico (este será su usuario)
   - Contraseña (mínimo 6 caracteres)
   - Teléfono de contacto

3. **Opciones de registro rápido** (Opcional):
   - También pueden usar el botón "Continuar con Google"
   - O el botón "Continuar con Microsoft"
   - Esto les permitirá registrarse sin crear una contraseña nueva

4. **Hacer clic en "Registrarse"**

5. **Automáticamente serán redirigidos** al Panel de Padres

---

## 2. PANEL DE PADRES - FUNCIONALIDADES

Una vez registrados e iniciando sesión, verán el **Panel de Padres** con una barra de navegación en la parte inferior de la pantalla (diseño móvil).

### 🏠 Pestaña: INICIO

Aquí verán un resumen general:
- **Saldo total** de todos sus hijos
- **Límite diario configurado**
- Botón para **Recargar saldo** rápidamente
- **Estadísticas del mes**: cuánto han gastado sus hijos
- **Alertas de saldo bajo** si algún hijo tiene menos de S/ 10

### 👦👧 Pestaña: HIJOS

Esta es la sección más importante. Aquí pueden:

#### ➕ Agregar un Nuevo Hijo/Estudiante:

1. Hacer clic en el botón **"+ Agregar Hijo"**
2. Rellenar los datos:
   - Nombre completo del estudiante
   - Grado (ej: 1ro, 2do, 3ro, etc.)
   - Sección (ej: A, B, C)
   - Saldo inicial (opcional, pueden dejarlo en 0)
   - Límite de gasto diario (ej: S/ 15.00)
3. Hacer clic en **"Guardar"**

#### 📊 Ver y Gestionar Estudiantes:

Cada tarjeta de hijo muestra:
- **Foto de perfil** (avatar)
- **Nombre y grado**
- **Saldo actual** (en grande, color verde)
- **Límite diario** configurado
- **Últimas 3 transacciones** (compras recientes)

#### 🔧 Acciones por Estudiante:

- **💰 Recargar Saldo**: Agregar dinero a la cuenta del estudiante
- **📊 Ver Historial Completo**: Todas las transacciones y compras
- **✏️ Editar Límite**: Cambiar el límite de gasto diario
- **🔴 Desactivar/Activar**: Si desactivan a un estudiante, no podrá comprar en el kiosco

### 🍔 Pestaña: MENÚ

Aquí pueden ver:
- **Todos los productos** disponibles en el kiosco
- **Precios actualizados**
- **Categorías**: Bebidas, Snacks, Menú del día
- Pueden **buscar productos específicos**

### 🥜 Pestaña: ALERGIAS

(Funcionalidad pendiente de implementación)
- Aquí podrán registrar alergias alimentarias de sus hijos
- El sistema alertará al personal del kiosco cuando un estudiante con alergias intente comprar un producto con esos ingredientes

### ⚙️ Pestaña: CONFIGURACIÓN

Opciones disponibles:
- **👤 Editar Perfil**: Cambiar nombre, email, teléfono
- **🔔 Notificaciones**: Configurar alertas (saldo bajo, compras grandes)
- **🌙 Modo Oscuro**: Cambiar apariencia de la app
- **🔒 Cambiar Contraseña**
- **📱 Ayuda y Soporte**
- **🚪 Cerrar Sesión**

---

## 3. MÓDULO DE PUNTO DE VENTA (POS)

Este módulo es para el personal del kiosco (cajeros). Vamos a probarlo juntos.

### 🔐 Credenciales de Acceso (Usuario de Prueba):

```
Usuario: prueba@limacafe28.com
Contraseña: 123456
Sede: Naciones Unidas - Sede Principal (Nordic)
```

### 🌐 Link de Acceso al Sistema:

```
https://rubennaldos.github.io/parent-portal-connect/
```

### 📝 Pasos para Ingresar al POS:

1. **Abrir el link** en el navegador
2. **Iniciar sesión** con las credenciales de arriba
3. **Seleccionar rol**: Marcar "Personal (POS/Cocina/Admin)"
4. **Hacer clic en "Iniciar Sesión"**
5. Automáticamente serán redirigidos al **Módulo POS**

---

### 🛒 CÓMO HACER UNA VENTA - PASO A PASO

#### **PASO 1: Seleccionar Tipo de Cliente**

Al iniciar, verán un modal con 2 opciones:

- **Cliente Genérico**: 
  - Para personas que NO son estudiantes (profesores, visitantes, etc.)
  - Pago al contado (Efectivo/Yape/Tarjeta)
  - Pueden elegir Ticket/Boleta/Factura
  
- **Estudiante**: 
  - Para estudiantes del colegio
  - Compra a **crédito** (se descuenta de su saldo)
  - También pueden pagar en **efectivo** si lo desean (opción con switch)

#### **PASO 2: Si eligen "Estudiante"**

1. **Buscar al estudiante** escribiendo su nombre
2. Aparecerá una lista de coincidencias
3. **Hacer clic** en el estudiante correcto
4. Se mostrará su **saldo actual** en grande (color verde)

#### **PASO 3: Agregar Productos al Carrito**

La pantalla está dividida en 3 zonas:

**ZONA 1: Categorías (Izquierda)**
- Todos
- Bebidas
- Snacks
- Menú

**ZONA 2: Productos (Centro)**
- Verán tarjetas grandes con:
  - Nombre del producto (grande)
  - Precio (más pequeño)
- **Hacer clic** en un producto para agregarlo al carrito

**ZONA 3: Ticket/Carrito (Derecha)**
- Nombre y saldo del estudiante (arriba)
- Lista de productos agregados
- Botones **+** y **-** para cambiar cantidades
- **Total a pagar** (abajo en grande)
- Botón **COBRAR** (verde, muy grande)

#### **PASO 4: Procesar la Venta**

1. **Verificar** que todos los productos estén correctos
2. **Hacer clic en el botón "COBRAR"** (verde, abajo)
3. Aparecerá un **modal de confirmación** mostrando:
   - Nombre del cliente/estudiante
   - Lista de productos con cantidades y precios
   - Total a pagar
   - **Saldo actual y saldo después** (si es estudiante a crédito)

4. **Elegir una opción:**
   - **✅ Confirmar y Continuar** (Botón Verde): Procesa la venta y vuelve al inicio
   - **🖨️ Confirmar e Imprimir** (Botón Azul): Procesa la venta y abre la ventana de impresión
   - **Cancelar** (Botón pequeño): Cancela y vuelve al carrito

5. **Listo!** La venta se ha procesado:
   - Se genera un **correlativo único** (ej: FN1-001, FN1-002, etc.)
   - Se descuenta el saldo del estudiante (si fue a crédito)
   - Aparece una notificación verde: "✅ Venta Realizada"
   - Automáticamente vuelve al **modal de selección** para atender al siguiente cliente

---

### 🎯 CARACTERÍSTICAS ESPECIALES DEL POS

#### ✅ Venta Rápida (Fast Food Style):
- Interfaz inspirada en sistemas de comida rápida
- Diseño táctil para pantallas touch
- Botones grandes y fáciles de tocar
- Proceso de venta en menos de 10 segundos

#### 🔢 Sistema de Correlativos Automáticos:
- Cada cajero tiene su propio **prefijo único**
  - Ejemplo: FN1, FN2, FN3 (Nordic: Sede 1, 2, 3)
  - FSG1, FSG2 (Sagrado Corazón)
- Los números se **reinician automáticamente cada día**
- Ejemplo: FN1-001, FN1-002, ... FN1-150 (hoy)
- Mañana: FN1-001 (empieza de nuevo)

#### 💳 Estudiantes a Crédito vs Efectivo:
- **Por defecto**: Los estudiantes compran a crédito (se descuenta de su saldo)
- **Switch opcional**: "Estudiante pagará en efectivo"
  - Si lo activan, NO se descuenta el saldo
  - Se registra como pago en efectivo

#### 🚫 Validación de Saldo Insuficiente:
- Si un estudiante no tiene saldo suficiente
- El botón "COBRAR" se desactiva automáticamente
- Aparece un mensaje en rojo: "⚠️ Saldo insuficiente"
- Deben comunicar al padre para que recargue

#### 📱 Diseño Responsive:
- Funciona en computadoras de escritorio
- Funciona en tablets
- Funciona en celulares

#### 🔒 Botón "Cerrar Sesión":
- Al inicio del POS, en el modal de selección
- Por seguridad, para que otro cajero pueda entrar

---

## 4. FUNCIONALIDADES PENDIENTES

Queremos ser transparentes sobre lo que aún está en desarrollo:

### ⏳ En Proceso:

1. **🧾 Boletas y Facturas Electrónicas (SUNAT)**:
   - Por ahora, el sistema solo genera **tickets internos**
   - La integración con SUNAT para boletas/facturas electrónicas está en desarrollo
   - El diseño del ticket actual es **temporal**, se mejorará con el logo de Lima Café 28

2. **🥜 Módulo de Alergias**:
   - Permitirá registrar alergias de estudiantes
   - Alertas automáticas al momento de comprar

3. **📊 Reportes para Administración**:
   - Ventas por día/semana/mes
   - Productos más vendidos
   - Horarios pico de ventas

4. **📲 Notificaciones Push**:
   - Alertas en tiempo real a los padres cuando sus hijos compran
   - Notificaciones de saldo bajo

5. **🖨️ Impresión Térmica Directa**:
   - Integración con impresoras térmicas 80mm
   - Por ahora, se usa "Imprimir" del navegador

---

## 5. CONTACTO Y SOPORTE

### 👨‍💻 Desarrollado por: **ARQUISIA**

Si durante las pruebas:
- Encuentran algún error o bug
- Tienen sugerencias de mejora
- Desean agregar o modificar alguna funcionalidad
- Tienen dudas sobre cómo usar el sistema

**Por favor, no duden en contactarme:**

📧 Email: [Tu email aquí]  
📱 WhatsApp: [Tu número aquí]  
💼 Empresa: ARQUISIA - Soluciones ERP

---

## 📝 RECOMENDACIONES PARA LA PRUEBA

### ✅ Cosas a Probar:

1. **Registrarse como padre** usando el link de Nordic
2. **Agregar 2-3 hijos** con diferentes saldos y límites
3. **Recargar saldo** a uno de los hijos
4. **Ver el historial** de transacciones
5. **Cambiar el límite diario** de un hijo
6. **Desactivar temporalmente** a un hijo
7. **Ingresar al POS** con el usuario prueba
8. **Hacer ventas** a los estudiantes que crearon
9. **Verificar** que el saldo se descuente correctamente
10. **Volver al Panel de Padres** y ver las compras reflejadas

### 💡 Preguntas Importantes:

Mientras prueban, piensen en:
- ¿Es intuitivo el proceso de venta?
- ¿Falta algún producto en el menú?
- ¿Los precios son correctos?
- ¿El diseño es agradable y profesional?
- ¿Hay algo que les gustaría cambiar?
- ¿Qué funcionalidades adicionales necesitarían?

---

## 🎉 ¡GRACIAS POR CONFIAR EN ARQUISIA!

Estamos emocionados de trabajar con ustedes en este proyecto. Este es solo el comienzo de un sistema que seguirá creciendo y mejorando según sus necesidades.

**¡A probar el sistema!** 🚀

---

**Última actualización:** 30 de Diciembre, 2025  
**Versión del Sistema:** 1.0 BETA  
**Desarrollado con ❤️ por ARQUISIA**

