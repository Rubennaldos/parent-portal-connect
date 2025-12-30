# 🎨 GUÍA: Agregar Pestañas al Dashboard de Padres

## 📋 LO QUE VAMOS A HACER

Vamos a transformar el dashboard actual de padres en un sistema con 6 pestañas organizadas:

```
[Alumnos] [Pagos] [Menús] [Nutrición] [Alergias] [Consultas]
```

---

## 🎯 ESTRUCTURA FINAL

### **Pestaña 1: Alumnos** 👨‍👩‍👧
- Grid de tarjetas de estudiantes (YA EXISTE)
- Botón "Agregar Estudiante"
- Acciones: Recargar, Ver Historial, Configurar Límite

### **Pestaña 2: Pagos** 💰
- Historial de todas las recargas
- Historial de todas las compras
- Balance total de todos los hijos
- Filtros por fecha, hijo, tipo

### **Pestaña 3: Menús** 📋
- Menú del día (lo que se sirve hoy)
- Menú de la semana (planificación)
- Información nutricional de cada plato
- Precios

### **Pestaña 4: Nutrición** 🍎
- Consejos nutricionales generales
- Tips para alimentación saludable
- Información de productos
- Historial de consumo de mi hijo

### **Pestaña 5: Alergias** ⚠️
- Mis hijos con alergias registradas
- Productos a evitar
- Alertas y recomendaciones
- Disclaimer de responsabilidad

### **Pestaña 6: Consultas** ❓
- Preguntas frecuentes
- Contacto con soporte
- Tutoriales de uso
- Políticas del kiosco

---

## 🔧 CAMBIOS EN EL CÓDIGO

### PASO 1: Agregar Tabs Component

Ya tienes importado `Tabs` de shadcn/ui. Lo usaremos así:

```tsx
<Tabs defaultValue="alumnos" className="w-full">
  <TabsList className="grid w-full grid-cols-6">
    <TabsTrigger value="alumnos">Alumnos</TabsTrigger>
    <TabsTrigger value="pagos">Pagos</TabsTrigger>
    <TabsTrigger value="menus">Menús</TabsTrigger>
    <TabsTrigger value="nutricion">Nutrición</TabsTrigger>
    <TabsTrigger value="alergias">Alergias</TabsTrigger>
    <TabsTrigger value="consultas">Consultas</TabsTrigger>
  </TabsList>

  <TabsContent value="alumnos">
    {/* Todo el código actual de estudiantes */}
  </TabsContent>

  <TabsContent value="pagos">
    {/* Nuevo: Historial de pagos */}
  </TabsContent>

  {/* ... más tabs */}
</Tabs>
```

---

### PASO 2: Mover Contenido Actual a Tab "Alumnos"

Todo el grid de estudiantes que ya tienes va dentro de:

```tsx
<TabsContent value="alumnos" className="space-y-4">
  {/* Estado vacío */}
  {students.length === 0 && (
    // ... tu código actual de "No hay estudiantes"
  )}

  {/* Grid de estudiantes */}
  {students.length > 0 && (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* ... tus tarjetas de estudiantes actuales */}
    </div>
  )}
</TabsContent>
```

---

### PASO 3: Crear Tab de Pagos

```tsx
<TabsContent value="pagos" className="space-y-4">
  <Card>
    <CardHeader>
      <CardTitle>Historial de Transacciones</CardTitle>
      <CardDescription>
        Todas las recargas y compras de tus hijos
      </CardDescription>
    </CardHeader>
    <CardContent>
      {/* Tabla de transacciones */}
      <div className="space-y-4">
        {/* Filtros */}
        <div className="flex gap-4">
          <Input placeholder="Buscar..." />
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="recharge">Recargas</SelectItem>
              <SelectItem value="purchase">Compras</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista de transacciones */}
        <div className="border rounded-lg">
          {/* Aquí irá la tabla */}
          <p className="text-center py-8 text-muted-foreground">
            No hay transacciones registradas
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</TabsContent>
```

---

### PASO 4: Crear Tab de Menús

```tsx
<TabsContent value="menus" className="space-y-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {/* Menú del día */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Utensils className="h-5 w-5" />
          Menú del Día
        </CardTitle>
        <CardDescription>
          {format(new Date(), 'EEEE, d MMMM yyyy', { locale: es })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="font-semibold mb-2">Entrada</h4>
          <p className="text-sm text-muted-foreground">Sopa de verduras</p>
        </div>
        <div>
          <h4 className="font-semibold mb-2">Segundo</h4>
          <p className="text-sm text-muted-foreground">Arroz con pollo y ensalada</p>
        </div>
        <div>
          <h4 className="font-semibold mb-2">Postre/Refresco</h4>
          <p className="text-sm text-muted-foreground">Gelatina de fresa</p>
        </div>
        <div className="pt-4 border-t">
          <p className="font-bold">Precio: S/ 8.00</p>
        </div>
      </CardContent>
    </Card>

    {/* Menú de la semana */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Menú de la Semana
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].map((day) => (
            <div key={day} className="p-3 bg-muted rounded-lg">
              <h4 className="font-semibold text-sm">{day}</h4>
              <p className="text-xs text-muted-foreground">Ver menú completo →</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  </div>
</TabsContent>
```

---

### PASO 5: Crear Tab de Nutrición

```tsx
<TabsContent value="nutricion" className="space-y-4">
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Apple className="h-5 w-5" />
        Información Nutricional
      </CardTitle>
      <CardDescription>
        Tips y consejos para una alimentación saludable
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {/* Consejos generales */}
      <div>
        <h3 className="font-semibold mb-3">Consejos Nutricionales</h3>
        <div className="space-y-2">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm">
              💚 Incluye al menos 3 porciones de frutas al día
            </p>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm">
              💧 Mantén a tu hijo hidratado con agua natural
            </p>
          </div>
          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm">
              🥗 Limita el consumo de snacks procesados
            </p>
          </div>
        </div>
      </div>

      {/* Productos disponibles con info nutricional */}
      <div>
        <h3 className="font-semibold mb-3">Productos del Kiosco</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-2">Jugo de Naranja Natural</h4>
              <div className="text-xs space-y-1 text-muted-foreground">
                <p>Calorías: 110 kcal</p>
                <p>Vitamina C: 100% VD</p>
                <p>Azúcares: 20g (naturales)</p>
              </div>
            </CardContent>
          </Card>
          {/* Más productos... */}
        </div>
      </div>
    </CardContent>
  </Card>
</TabsContent>
```

---

### PASO 6: Crear Tab de Alergias

```tsx
<TabsContent value="alergias" className="space-y-4">
  {/* Disclaimer importante */}
  <Card className="border-yellow-500 bg-yellow-50">
    <CardContent className="p-4">
      <div className="flex gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-yellow-900 mb-1">
            Aviso Importante sobre Alergias
          </p>
          <p className="text-yellow-800">
            El registro de alergias es <strong>solo informativo</strong>. 
            Lima Café 28 no se hace responsable por reacciones alérgicas. 
            Es responsabilidad de los padres verificar los ingredientes de cada producto.
          </p>
        </div>
      </div>
    </CardContent>
  </Card>

  {/* Alergias registradas */}
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5" />
        Alergias Registradas
      </CardTitle>
    </CardHeader>
    <CardContent>
      {/* Listar alergias de cada hijo */}
      <div className="space-y-4">
        {students.map((student) => (
          <div key={student.id} className="p-4 border rounded-lg">
            <h4 className="font-semibold mb-2">{student.full_name}</h4>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">Gluten</Badge>
              <Badge variant="destructive">Lácteos</Badge>
              <Badge variant="outline">Sin alergias registradas</Badge>
            </div>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>

  {/* Productos a evitar */}
  <Card>
    <CardHeader>
      <CardTitle>Productos a Evitar</CardTitle>
      <CardDescription>
        Según las alergias registradas
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm">Pan integral (contiene gluten)</span>
          <Badge variant="destructive">Evitar</Badge>
        </div>
        {/* Más productos... */}
      </div>
    </CardContent>
  </Card>
</TabsContent>
```

---

### PASO 7: Crear Tab de Consultas

```tsx
<TabsContent value="consultas" className="space-y-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {/* Preguntas Frecuentes */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Preguntas Frecuentes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="border-b pb-4">
          <summary className="font-medium cursor-pointer">
            ¿Cómo recargar saldo?
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Puedes recargar saldo directamente desde este portal usando Yape, Plin o tarjeta.
            También puedes hacerlo presencialmente en el kiosco.
          </p>
        </details>
        
        <details className="border-b pb-4">
          <summary className="font-medium cursor-pointer">
            ¿Cuál es el límite diario?
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Por defecto es S/ 15.00, pero puedes personalizarlo para cada hijo desde la pestaña "Alumnos".
          </p>
        </details>

        <details className="border-b pb-4">
          <summary className="font-medium cursor-pointer">
            ¿Puedo ver qué compra mi hijo?
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Sí, en la pestaña "Pagos" verás el historial detallado de todas sus compras.
          </p>
        </details>
      </CardContent>
    </Card>

    {/* Contacto */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Contáctanos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-muted rounded-lg">
          <h4 className="font-semibold mb-2">Soporte Técnico</h4>
          <p className="text-sm text-muted-foreground mb-3">
            ¿Tienes problemas con el sistema?
          </p>
          <Button variant="outline" className="w-full">
            <Mail className="h-4 w-4 mr-2" />
            Enviar Email
          </Button>
        </div>

        <div className="p-4 bg-muted rounded-lg">
          <h4 className="font-semibold mb-2">Kiosco</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Consultas sobre productos y menús
          </p>
          <Button variant="outline" className="w-full">
            <Phone className="h-4 w-4 mr-2" />
            Llamar
          </Button>
        </div>

        <div className="p-4 bg-primary/10 rounded-lg">
          <h4 className="font-semibold mb-2">Horario de Atención</h4>
          <p className="text-sm">
            Lunes a Viernes: 7:00 AM - 4:00 PM
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</TabsContent>
```

---

## 🎯 SIGUIENTE PASO

Ahora que entiendes la estructura, voy a aplicar estos cambios en tu `Index.tsx`.

**¿Estás listo para que modifique el archivo?**

Dime:
- **"Sí, hazlo"** → Aplico los cambios ahora
- **"Espera, explícame más"** → Te doy más detalles
- **"Primero muéstrame un ejemplo"** → Te creo un componente de prueba pequeño

¿Qué prefieres? 🚀


