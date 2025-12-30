# 🔧 ARREGLAR PÁGINA EN BLANCO - GitHub Pages

## 🚨 PROBLEMA
La página https://rubennaldos.github.io/parent-portal-connect/ se ve en blanco.

**Causa:** GitHub Pages no estaba configurado correctamente para proyectos Vite/React.

---

## ✅ SOLUCIÓN APLICADA

### 1. Configuré `vite.config.ts`
Agregué el `base` path para GitHub Pages:
```typescript
base: mode === "production" ? "/parent-portal-connect/" : "/",
```

### 2. Creé GitHub Actions Workflow
Archivo: `.github/workflows/deploy.yml`
- Compila automáticamente el proyecto
- Despliega en GitHub Pages cada vez que haces push a `main`

---

## 📋 PASOS PARA ARREGLAR (5 MINUTOS)

### PASO 1: Subir los cambios a GitHub

```bash
# Asegúrate de estar en la carpeta del proyecto
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect

# Agregar cambios
git add .

# Commit
git commit -m "fix: configurar GitHub Pages correctamente"

# Push
git push origin main
```

---

### PASO 2: Configurar GitHub Pages en el Repositorio

1. Ve a tu repositorio en GitHub:
   https://github.com/rubennaldos/parent-portal-connect

2. Click en **Settings** (⚙️ arriba a la derecha)

3. En el menú izquierdo, click en **Pages**

4. En "Build and deployment":
   - **Source:** Selecciona `GitHub Actions`
   - (NO selecciones "Deploy from a branch")

5. Click **Save**

---

### PASO 3: Esperar el Deploy (2-3 minutos)

1. Ve a la pestaña **Actions** en tu repositorio:
   https://github.com/rubennaldos/parent-portal-connect/actions

2. Verás un workflow corriendo (círculo amarillo 🟡)

3. Espera a que se ponga verde (✅)

4. Cuando termine, abre tu página:
   https://rubennaldos.github.io/parent-portal-connect/

5. **¡Debería funcionar!** 🎉

---

## 🔍 VERIFICAR QUE FUNCIONA

Abre estas URLs y verifica:

✅ **Página principal:**
https://rubennaldos.github.io/parent-portal-connect/

✅ **Login:**
https://rubennaldos.github.io/parent-portal-connect/auth

✅ **Registro:**
https://rubennaldos.github.io/parent-portal-connect/register

✅ **SuperAdmin:**
https://rubennaldos.github.io/parent-portal-connect/superadmin

---

## 🆘 SI SIGUE EN BLANCO

### Opción 1: Limpiar caché del navegador

```bash
# En Chrome/Edge:
1. Presiona Ctrl + Shift + Delete
2. Selecciona "Imágenes y archivos en caché"
3. Click en "Borrar datos"
4. Recarga la página (F5)
```

### Opción 2: Verificar el estado del deploy

```bash
# Ve a GitHub Actions:
https://github.com/rubennaldos/parent-portal-connect/actions

# Si hay un error (❌):
1. Click en el workflow fallido
2. Lee el error
3. Copia el mensaje de error
4. Dímelo para ayudarte a arreglarlo
```

### Opción 3: Verificar configuración de Pages

1. Ve a Settings → Pages
2. Verifica que diga:
   - **Source:** GitHub Actions
   - **Custom domain:** (vacío o tu dominio personalizado)

---

## 📊 CÓMO FUNCIONA AHORA

```
TÚ HACES:                    GITHUB HACE:
───────────                  ──────────────

git push origin main    →    1. Detecta el push
                             2. Ejecuta workflow de GitHub Actions
                             3. npm install
                             4. npm run build (genera carpeta dist/)
                             5. Despliega dist/ en GitHub Pages
                             6. ✅ Página actualizada en 2-3 minutos
```

---

## 🎯 VENTAJAS DE ESTE SISTEMA

✅ **Deploy automático:** Solo haces `git push`, GitHub se encarga del resto
✅ **Build correcto:** Siempre compila con las configuraciones correctas
✅ **Historial:** Puedes ver todos los deploys en la pestaña Actions
✅ **Rollback:** Si algo sale mal, puedes volver a una versión anterior

---

## 📝 COMANDOS ÚTILES

### Ver logs de deploy en GitHub
```bash
# Abre en el navegador:
https://github.com/rubennaldos/parent-portal-connect/actions
```

### Forzar un nuevo deploy sin cambios
```bash
# En tu terminal:
git commit --allow-empty -m "chore: trigger deploy"
git push origin main
```

### Verificar qué se está desplegando localmente
```bash
npm run build
# Abre la carpeta dist/ y verifica los archivos
```

---

## ✅ CHECKLIST DE SOLUCIÓN

- [ ] ✅ Hice `git push origin main`
- [ ] ✅ Fui a Settings → Pages
- [ ] ✅ Seleccioné "GitHub Actions" como source
- [ ] ✅ Esperé 2-3 minutos
- [ ] ✅ Verifiqué que el workflow terminó (✅ verde)
- [ ] ✅ Abrí la página y funciona

---

## 🎓 ¿POR QUÉ ESTABA EN BLANCO?

**Antes:**
```
GitHub Pages buscaba:
https://rubennaldos.github.io/src/main.tsx ❌ (No existe)

El archivo real estaba en:
.../parent-portal-connect/dist/assets/index-abc123.js
Pero GitHub no sabía dónde buscarlo.
```

**Ahora:**
```
GitHub Actions compila el proyecto:
src/ → dist/assets/index-abc123.js ✅

GitHub Pages sirve desde dist/:
https://rubennaldos.github.io/parent-portal-connect/ ✅
```

---

**¿Hiciste el push? ¿Ya funciona la página? 🎉**


