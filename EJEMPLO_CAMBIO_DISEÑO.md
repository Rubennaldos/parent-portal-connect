# 🎨 Ejemplo: Cambiar SuperAdmin a Azul Neón

## Paso 1: Cambiar el fondo
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 82

**De:**
```typescript
<div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
```

**A:**
```typescript
<div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
```

---

## Paso 2: Cambiar el color del header
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 84

**De:**
```typescript
<div className="bg-purple-900/30 border-b border-purple-500/30 px-4 py-1">
  <p className="text-xs font-mono text-purple-300 text-center">
```

**A:**
```typescript
<div className="bg-blue-900/30 border-b border-blue-500/30 px-4 py-1">
  <p className="text-xs font-mono text-blue-300 text-center">
```

---

## Paso 3: Cambiar el icono
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 93

**De:**
```typescript
<div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl">
```

**A:**
```typescript
<div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl">
```

---

## Paso 4: Cambiar el título
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 98

**De:**
```typescript
<h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
```

**A:**
```typescript
<h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
```

---

## Paso 5: Cambiar color de las tabs
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 133

**De:**
```typescript
<TabsList className="grid w-full grid-cols-5 bg-slate-900/50 border border-purple-500/30">
  <TabsTrigger value="overview" className="data-[state=active]:bg-purple-600">
```

**A:**
```typescript
<TabsList className="grid w-full grid-cols-5 bg-slate-900/50 border border-blue-500/30">
  <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600">
```

---

## Paso 6: Cambiar botones
**Archivo:** `src/pages/SuperAdmin.tsx` - Línea 235

**De:**
```typescript
<Button className="w-full bg-gradient-to-r from-purple-600 to-pink-600">
```

**A:**
```typescript
<Button className="w-full bg-gradient-to-r from-blue-600 to-cyan-600">
```

---

## Resultado:
- ❌ Morado/Rosa
- ✅ Azul Neón/Cyan

---

## 🎨 Paleta de Colores Tailwind

### Morados
- `purple-950` (muy oscuro)
- `purple-900`
- `purple-600` (medio)
- `purple-400` (claro)
- `purple-300`

### Azules
- `blue-950` (muy oscuro)
- `blue-900`
- `blue-600` (medio)
- `blue-400` (claro)
- `blue-300`

### Verdes
- `green-950`
- `green-600`
- `green-400`

### Rojos
- `red-950`
- `red-600`
- `red-400`

### Naranjas
- `orange-950`
- `orange-600`
- `orange-400`

---

## 🔍 Buscar y Reemplazar Rápido

En VS Code / Cursor:
1. `Ctrl + H` (Buscar y Reemplazar)
2. Buscar: `purple-`
3. Reemplazar: `blue-`
4. Replace All en `SuperAdmin.tsx`

¡Listo! Todo el panel cambia de morado a azul.


