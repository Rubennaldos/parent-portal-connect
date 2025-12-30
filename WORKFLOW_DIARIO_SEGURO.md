# 🛡️ WORKFLOW DIARIO SEGURO
## Para NO Perder Nunca Más Tu Trabajo

---

## 🚨 PROBLEMA QUE VAMOS A SOLUCIONAR

```
❌ ANTES (Riesgoso):
├─ Trabajas 3 horas
├─ No haces commit
├─ Se apaga la PC
└─ 😭 TODO PERDIDO

✅ AHORA (Seguro):
├─ Trabajas 15 minutos → commit → push
├─ Trabajas 15 minutos → commit → push
├─ Se apaga la PC
└─ 😊 TODO GUARDADO en GitHub
```

---

## 📋 REGLA DE ORO

### **💾 GUARDA TU TRABAJO CADA 15-30 MINUTOS**

No esperes a terminar. Haz commits pequeños y frecuentes.

```bash
# Cada 15-30 minutos:
git add .
git commit -m "trabajo en progreso: agregando tabs"
git push origin TU_RAMA

# ✅ Ahora tu trabajo está en GitHub
# ✅ Aunque se apague la PC, está guardado
```

---

## 🎯 WORKFLOW COMPLETO (HOY)

### **PASO 1: Crear rama de trabajo** (Solo UNA VEZ al empezar)

```bash
# 1. Ir a la carpeta del proyecto
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect

# 2. Asegurarte de estar en main
git checkout main

# 3. Traer últimos cambios
git pull origin main

# 4. Crear rama nueva
git checkout -b feature/pestanas-dashboard-padres
```

**Explicación:** 
- Ahora estás en una rama nueva
- Todo lo que hagas aquí NO afecta a `main` (producción)
- El cliente sigue viendo la versión estable

---

### **PASO 2: Trabajar y GUARDAR FRECUENTEMENTE** (REPITE ESTO)

```bash
# 1. Haz cambios en el código (10-30 minutos)
# (Editas archivos en VS Code/Cursor)

# 2. Guarda tu progreso en Git
git add .
git commit -m "feat: estructura de tabs agregada"

# 3. SUBE A GITHUB (ESTO ES CRÍTICO)
git push origin feature/pestanas-dashboard-padres

# ✅ Listo! Tu trabajo está guardado en la nube
# ✅ Aunque se apague la PC, no pierdes nada
```

**🔄 REPITE EL PASO 2 CADA 15-30 MINUTOS:**

```bash
# Primera vez (10:00 AM):
git add .
git commit -m "feat: tabs de alumnos y pagos"
git push origin feature/pestanas-dashboard-padres

# Segunda vez (10:30 AM):
git add .
git commit -m "feat: tab de menus agregado"
git push origin feature/pestanas-dashboard-padres

# Tercera vez (11:00 AM):
git add .
git commit -m "feat: tab de nutricion funcional"
git push origin feature/pestanas-dashboard-padres

# ✅ Si se apaga la PC a las 11:15 AM, solo pierdes 15 minutos
```

---

### **PASO 3: Cuando termines la funcionalidad (FIN DEL DÍA)**

```bash
# 1. Último commit
git add .
git commit -m "feat: pestanas dashboard completo"
git push origin feature/pestanas-dashboard-padres

# 2. Prueba que todo funcione
npm run dev
# (Verifica en el navegador)

# 3. Si TODO está bien, haz merge a main
git checkout main
git pull origin main
git merge feature/pestanas-dashboard-padres

# 4. Sube a producción
git push origin main

# 5. Espera 2-3 minutos
# Los cambios estarán en: https://rubennaldos.github.io/parent-portal-connect/

# 6. Borra la rama de feature (ya no la necesitas)
git branch -d feature/pestanas-dashboard-padres
```

---

### **PASO 4: Si NO terminaste hoy (Continuar mañana)**

```bash
# HOY (6:00 PM - No terminaste):
git add .
git commit -m "wip: tabs en progreso, faltan alergias y consultas"
git push origin feature/pestanas-dashboard-padres

# ✅ Apaga tu PC tranquilo
# ✅ Tu trabajo está guardado en GitHub

# MAÑANA (9:00 AM):
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect
git checkout feature/pestanas-dashboard-padres
git pull origin feature/pestanas-dashboard-padres

# ✅ Continúas donde te quedaste
npm run dev
```

---

## 🆘 SI SE APAGA LA PC SIN GUARDAR

### **Escenario 1: Hiciste push hace menos de 1 hora**

```bash
# Al encender la PC:
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect
git checkout feature/pestanas-dashboard-padres
git pull origin feature/pestanas-dashboard-padres

# ✅ Recuperas casi todo
# ❌ Solo pierdes lo último que no guardaste (máximo 1 hora)
```

---

### **Escenario 2: NO hiciste push (perdiste trabajo local)**

```bash
# Al encender la PC:
git checkout feature/pestanas-dashboard-padres
git pull origin feature/pestanas-dashboard-padres

# ⚠️ Recuperas hasta el último push
# ❌ Pierdes todo lo que no subiste

# POR ESO: HAZ PUSH CADA 15-30 MINUTOS
```

---

## ⏰ FRECUENCIA DE COMMITS/PUSH

### **Recomendado:**

```
Cada 15-30 minutos:
├─ Pequeños cambios → commit → push
├─ Agregaste un componente → commit → push
├─ Terminaste una sección → commit → push
└─ Antes de tomar descanso → commit → push
```

### **Ejemplos de commits buenos:**

```bash
git commit -m "feat: estructura de tabs creada"
git commit -m "feat: tab de alumnos movido"
git commit -m "feat: tab de pagos con tabla"
git commit -m "feat: tab de menus con cards"
git commit -m "style: mejorar diseño de tabs"
git commit -m "fix: corregir error en tab nutricion"
git commit -m "wip: tabs en progreso" # WIP = Work In Progress
```

---

## 🎯 COMANDOS ESENCIALES (Cheat Sheet)

### **Guardar trabajo (ÚSALO FRECUENTEMENTE):**
```bash
git add .
git commit -m "descripción breve"
git push origin NOMBRE_DE_TU_RAMA
```

### **Ver en qué rama estás:**
```bash
git branch
# * feature/pestanas-dashboard-padres  ← Aquí estás
#   main
```

### **Ver qué archivos cambiaste:**
```bash
git status
```

### **Ver últimos commits:**
```bash
git log --oneline -10
```

### **Cambiar de rama:**
```bash
git checkout main                        # Ir a main
git checkout feature/pestanas-dashboard  # Ir a feature
```

### **Traer cambios de GitHub:**
```bash
git pull origin NOMBRE_DE_RAMA
```

---

## 🔄 EJEMPLO REAL DE HOY

```bash
# 10:00 AM - Empezar
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect
git checkout main
git pull origin main
git checkout -b feature/pestanas-dashboard-padres
npm run dev

# 10:30 AM - Primera parte lista
git add .
git commit -m "feat: estructura de 6 tabs creada"
git push origin feature/pestanas-dashboard-padres
# ✅ GUARDADO

# 11:00 AM - Tab de alumnos listo
git add .
git commit -m "feat: contenido actual movido a tab alumnos"
git push origin feature/pestanas-dashboard-padres
# ✅ GUARDADO

# 11:30 AM - Tab de pagos listo
git add .
git commit -m "feat: tab de pagos con tabla de transacciones"
git push origin feature/pestanas-dashboard-padres
# ✅ GUARDADO

# 12:00 PM - Almuerzo
git add .
git commit -m "wip: tabs en progreso, faltan 3"
git push origin feature/pestanas-dashboard-padres
# ✅ GUARDADO - Puedes almorzar tranquilo

# 1:00 PM - Continuar
npm run dev
# Sigues trabajando...

# 2:00 PM - TODO listo
git add .
git commit -m "feat: todas las tabs completadas y probadas"
git push origin feature/pestanas-dashboard-padres

# Probar todo
npm run build  # Verifica que compile

# Subir a producción
git checkout main
git merge feature/pestanas-dashboard-padres
git push origin main

# ✅ En 3 minutos, el cliente ve los cambios
```

---

## 💡 TIPS PROFESIONALES

### **1. Commits descriptivos:**
```bash
✅ BUENO:
git commit -m "feat: agregar tab de menus con menu del dia"
git commit -m "fix: corregir error de carga en tab pagos"
git commit -m "style: mejorar responsive de tabs en mobile"

❌ MALO:
git commit -m "cambios"
git commit -m "fix"
git commit -m "asdf"
```

### **2. Push antes de:**
- ✅ Almuerzo
- ✅ Descansos
- ✅ Terminar el día
- ✅ Cada 30 minutos de trabajo continuo
- ✅ Antes de cambiar de funcionalidad

### **3. NO hagas push de:**
- ❌ Código que no compila
- ❌ Código con errores obvios
- ✅ Código en progreso está OK (usa "wip:")

---

## 🎓 PREFIJOS DE COMMITS (Convención)

```bash
feat:     # Nueva funcionalidad
fix:      # Arreglo de bug
style:    # Cambios de diseño/estilos
refactor: # Mejora de código sin cambiar funcionalidad
wip:      # Work in progress (trabajo en progreso)
docs:     # Documentación
chore:    # Tareas de mantenimiento

# Ejemplos:
git commit -m "feat: tab de nutricion con tips"
git commit -m "fix: error al cargar transacciones"
git commit -m "style: mejorar colores de tabs"
git commit -m "wip: tabs en desarrollo"
```

---

## ✅ CHECKLIST DIARIO

### **Al empezar el día:**
- [ ] `cd` a la carpeta del proyecto
- [ ] `git checkout` a tu rama de trabajo
- [ ] `git pull origin` tu-rama
- [ ] `npm run dev`

### **Cada 30 minutos:**
- [ ] `git add .`
- [ ] `git commit -m "descripción"`
- [ ] `git push origin` tu-rama

### **Al terminar el día:**
- [ ] Último `git push`
- [ ] Si está listo → merge a `main`
- [ ] Si NO está listo → déjalo en la rama

---

## 🆘 COMANDOS DE EMERGENCIA

### **"Me equivoqué en el último commit":**
```bash
git reset --soft HEAD~1  # Deshace el commit pero mantiene cambios
git add .
git commit -m "mensaje correcto"
```

### **"Quiero descartar TODOS los cambios no guardados":**
```bash
git reset --hard HEAD
# ⚠️ CUIDADO: Borra todo lo que no commiteaste
```

### **"Quiero ver qué cambié":**
```bash
git diff  # Ver cambios no guardados
git log   # Ver historial de commits
```

---

## 🎯 RESUMEN ULTRA-RÁPIDO

```bash
# INICIO (una vez):
git checkout -b feature/nombre

# TRABAJO (cada 30 min):
git add .
git commit -m "lo que hiciste"
git push origin feature/nombre

# FIN (cuando esté listo):
git checkout main
git merge feature/nombre
git push origin main
```

---

**¿Entendiste el workflow? ¿Quieres que empecemos a aplicarlo ahora?** 🚀

Dime:
- **"Sí, empecemos"** → Te guío comando por comando
- **"Tengo dudas sobre..."** → Pregúntame lo que sea
- **"Dame un ejemplo más simple"** → Te lo simplifico más


