# 🎯 WORKFLOW PROFESIONAL - Guía Paso a Paso

## ✅ SITUACIÓN ACTUAL

Tu sistema está desplegado en:
- **Producción (Cliente):** https://rubennaldos.github.io/parent-portal-connect/
- **Repositorio:** GitHub (rama `main`)
- **Base de Datos:** Supabase PROD

---

## 🚨 REGLAS DE ORO (NUNCA ROMPER)

### ❌ NUNCA HAGAS ESTO:
1. ❌ NO trabajes directamente en la rama `main`
2. ❌ NO hagas `git push -f` (force push)
3. ❌ NO hagas cambios sin probar primero localmente
4. ❌ NO borres archivos importantes sin verificar
5. ❌ NO cambies la base de datos de producción sin backup

### ✅ SIEMPRE HAZ ESTO:
1. ✅ Trabaja en ramas separadas (`feature/`)
2. ✅ Prueba TODO localmente antes de subir
3. ✅ Haz commits pequeños y frecuentes
4. ✅ Escribe mensajes de commit claros
5. ✅ Haz backup de la base de datos antes de cambios grandes

---

## 📋 WORKFLOW DIARIO (PASO A PASO)

### 🌅 ANTES DE EMPEZAR A TRABAJAR

```bash
# 1. Asegúrate de estar en la carpeta del proyecto
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect

# 2. Verifica en qué rama estás
git branch
# Deberías ver: * main

# 3. Trae los últimos cambios (por si alguien más subió algo)
git pull origin main

# 4. Verifica que no haya cambios sin guardar
git status
# Debería decir: "nothing to commit, working tree clean"
```

---

### 🛠️ COMENZAR UNA NUEVA FUNCIONALIDAD

**Ejemplo: Vas a agregar la pestaña "Pagos" al dashboard de padres**

```bash
# 1. Crear una nueva rama desde main
git checkout main
git checkout -b feature/pagos-dashboard

# Ahora estás en la rama "feature/pagos-dashboard"
# IMPORTANTE: TODO lo que hagas aquí NO afecta a main (producción)
```

**Nombres sugeridos para ramas:**
- `feature/nombre-funcionalidad` - Para nuevas funcionalidades
- `fix/nombre-del-bug` - Para arreglar errores
- `refactor/nombre-componente` - Para mejorar código existente

---

### 💻 TRABAJAR EN TU FUNCIONALIDAD

```bash
# 1. Inicia el servidor local
npm run dev

# 2. Abre el navegador en: http://localhost:5173

# 3. Edita tus archivos en VS Code/Cursor
# (Ej: src/pages/Index.tsx)

# 4. Cada vez que hagas un cambio significativo, guárdalo:
git add .
git commit -m "feat: agregar sección de pagos pendientes"

# 5. Sigue trabajando...
# Haz commits cada 15-30 minutos o cuando completes una parte
```

**Ejemplos de mensajes de commit:**
```bash
git commit -m "feat: crear componente PaymentsTab"
git commit -m "fix: corregir error de carga de estudiantes"
git commit -m "style: mejorar diseño de tarjetas de pago"
git commit -m "refactor: optimizar consulta de transacciones"
```

---

### ✅ PROBAR TU FUNCIONALIDAD

**CHECKLIST ANTES DE SUBIR:**

- [ ] ✅ La funcionalidad funciona en `localhost:5173`
- [ ] ✅ No hay errores en la consola del navegador (F12)
- [ ] ✅ Probaste con diferentes usuarios (padre, admin)
- [ ] ✅ No rompiste funcionalidades existentes
- [ ] ✅ El código está limpio (sin `console.log` de prueba)

```bash
# Verificar que no haya errores de TypeScript
npm run build

# Si todo compila bien, estás listo para subir
```

---

### 🚀 SUBIR TU FUNCIONALIDAD (MERGE A MAIN)

**OPCIÓN A: Merge Directo (Proyecto Personal)**

```bash
# 1. Asegúrate de que todo esté commiteado
git status
# Debe decir: "nothing to commit"

# 2. Cambia a la rama main
git checkout main

# 3. Trae los últimos cambios
git pull origin main

# 4. Haz merge de tu rama de funcionalidad
git merge feature/pagos-dashboard

# 5. Si NO hay conflictos, sube a GitHub
git push origin main

# 6. Espera 2-3 minutos
# GitHub Pages se actualiza automáticamente
# Tu funcionalidad ya está en: https://rubennaldos.github.io/parent-portal-connect/

# 7. Borra la rama de funcionalidad (ya no la necesitas)
git branch -d feature/pagos-dashboard
```

**OPCIÓN B: Pull Request (Más Profesional)**

```bash
# 1. Sube tu rama a GitHub
git push origin feature/pagos-dashboard

# 2. Ve a GitHub: https://github.com/rubennaldos/parent-portal-connect
# 3. Verás un botón: "Compare & pull request"
# 4. Click en él
# 5. Escribe descripción de los cambios
# 6. Click "Create pull request"
# 7. Revisa los cambios
# 8. Click "Merge pull request"
# 9. Click "Confirm merge"
# 10. Borra la rama en GitHub
```

---

### 🆘 SI ALGO SALE MAL

#### Escenario 1: Subiste algo roto a main

```bash
# Ver el historial de commits
git log --oneline

# Copiar el ID del commit ANTES del que rompió todo
# Ejemplo: abc1234

# Volver a ese commit
git reset --hard abc1234

# Forzar el push (SOLO en emergencias)
git push origin main --force

# ⚠️ ADVERTENCIA: Esto borra los commits posteriores
```

#### Escenario 2: Rompiste algo localmente

```bash
# Descartar TODOS los cambios no guardados
git reset --hard HEAD

# O descartar solo un archivo
git checkout -- src/pages/Index.tsx
```

#### Escenario 3: Quieres probar algo sin miedo

```bash
# Crear una rama de prueba
git checkout -b experimental/prueba-loca

# Haz lo que quieras aquí
# Si sale mal, simplemente:
git checkout main
git branch -D experimental/prueba-loca
```

---

## 🔄 WORKFLOW VISUAL

```
┌────────────────────────────────────────────────────────┐
│  1. EMPEZAR DÍA                                        │
├────────────────────────────────────────────────────────┤
│  git checkout main                                     │
│  git pull origin main                                  │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  2. CREAR RAMA NUEVA                                   │
├────────────────────────────────────────────────────────┤
│  git checkout -b feature/mi-funcionalidad              │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  3. TRABAJAR Y HACER COMMITS                           │
├────────────────────────────────────────────────────────┤
│  npm run dev                                           │
│  (editar código)                                       │
│  git add .                                             │
│  git commit -m "feat: ..."                             │
│  (repetir varias veces)                                │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  4. PROBAR TODO                                        │
├────────────────────────────────────────────────────────┤
│  ✅ Funciona en localhost                             │
│  ✅ No hay errores en consola                         │
│  ✅ npm run build sin errores                         │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  5. MERGE A MAIN                                       │
├────────────────────────────────────────────────────────┤
│  git checkout main                                     │
│  git pull origin main                                  │
│  git merge feature/mi-funcionalidad                    │
│  git push origin main                                  │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  6. VERIFICAR EN PRODUCCIÓN                            │
├────────────────────────────────────────────────────────┤
│  Esperar 2-3 minutos                                   │
│  Abrir: https://rubennaldos.github.io/...              │
│  ✅ Todo funciona                                      │
└────────────────────────────────────────────────────────┘
                        ⬇️
┌────────────────────────────────────────────────────────┐
│  7. LIMPIAR                                            │
├────────────────────────────────────────────────────────┤
│  git branch -d feature/mi-funcionalidad                │
└────────────────────────────────────────────────────────┘
```

---

## 📊 EJEMPLO REAL COMPLETO

**Tarea: Agregar botón "Menus" al Dashboard de Padres**

```bash
# ================================
# DÍA 1 - EMPEZAR LA FUNCIONALIDAD
# ================================

# 1. Preparar el entorno
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect
git checkout main
git pull origin main

# 2. Crear rama
git checkout -b feature/menus-tab

# 3. Iniciar servidor
npm run dev

# 4. Editar src/pages/Index.tsx
# (Agregar la pestaña de Menus)

# 5. Guardar progreso
git add .
git commit -m "feat: agregar estructura de pestaña Menus"

# 6. Seguir trabajando...
# (Agregar componentes, estilos, etc.)

# 7. Más commits
git add .
git commit -m "feat: crear componente MenuOfTheDay"
git commit -m "feat: agregar consulta a base de datos para menus"
git commit -m "style: mejorar diseño de tarjetas de menu"

# 8. Al final del día, subir tu rama (backup en la nube)
git push origin feature/menus-tab

# ================================
# DÍA 2 - CONTINUAR Y FINALIZAR
# ================================

# 1. Continuar donde te quedaste
git checkout feature/menus-tab
git pull origin feature/menus-tab

# 2. Seguir trabajando
npm run dev
# (terminar funcionalidad)

# 3. Último commit
git add .
git commit -m "feat: finalizar funcionalidad de Menus"

# 4. PROBAR TODO
npm run build
# ✅ Todo compila bien

# 5. Verificar en localhost
# ✅ Todo funciona perfectamente

# 6. MERGE A MAIN (Producción)
git checkout main
git pull origin main
git merge feature/menus-tab

# 7. Subir a GitHub
git push origin main

# 8. Esperar 3 minutos y verificar
# Abrir: https://rubennaldos.github.io/parent-portal-connect/
# ✅ La nueva funcionalidad está en producción

# 9. Limpiar
git branch -d feature/menus-tab
git push origin --delete feature/menus-tab
```

---

## 🎓 COMANDOS ESENCIALES (Cheat Sheet)

### Ver estado actual
```bash
git status                    # ¿Qué archivos cambiaron?
git branch                    # ¿En qué rama estoy?
git log --oneline -10         # Últimos 10 commits
```

### Trabajar con ramas
```bash
git checkout main             # Ir a rama main
git checkout -b feature/X     # Crear y cambiar a rama nueva
git branch -d feature/X       # Borrar rama local
git push origin --delete X    # Borrar rama en GitHub
```

### Guardar cambios
```bash
git add .                     # Agregar todos los archios
git add archivo.tsx           # Agregar un archivo específico
git commit -m "mensaje"       # Guardar cambios
git push origin RAMA          # Subir a GitHub
```

### Sincronizar
```bash
git pull origin main          # Traer cambios de GitHub
git fetch origin              # Ver cambios sin aplicarlos
```

### Deshacer cambios
```bash
git checkout -- archivo.tsx   # Descartar cambios de un archivo
git reset --hard HEAD         # Descartar TODOS los cambios
git reset --soft HEAD~1       # Deshacer último commit (mantener cambios)
```

---

## 🛡️ PROTECCIÓN EXTRA: GitHub Actions

Puedes configurar pruebas automáticas antes de hacer merge:

```yaml
# .github/workflows/test.yml
name: Test Before Merge
on:
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
      - name: Test
        run: npm test
```

Esto evita que subas código roto a main.

---

## 📚 RECURSOS ADICIONALES

- [Git Cheat Sheet PDF](https://education.github.com/git-cheat-sheet-education.pdf)
- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

## ✅ CHECKLIST FINAL ANTES DE ENTREGAR AL CLIENTE

- [ ] ✅ Todas las funcionalidades funcionan en producción
- [ ] ✅ No hay errores en la consola del navegador
- [ ] ✅ El diseño se ve bien en móvil y desktop
- [ ] ✅ Probaste con usuarios de diferentes roles (padre, admin, pos)
- [ ] ✅ La base de datos tiene datos de ejemplo
- [ ] ✅ Eliminaste todos los `console.log` de debug
- [ ] ✅ El código está comentado en partes complejas
- [ ] ✅ Hiciste backup de la base de datos

---

**¡Ahora estás trabajando como un profesional! 🎯**


