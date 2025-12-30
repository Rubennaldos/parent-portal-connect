# ⚡ ACCIÓN INMEDIATA - Qué Hacer AHORA

## 🎯 TU OBJETIVO
Entregar el link al cliente sin miedo a romper el código cuando sigas trabajando.

---

## ✅ PLAN DE 30 MINUTOS

### PASO 1: Verificar Producción (5 minutos)

```bash
# Abre estos links en modo incógnito y verifica que funcionen:

1. https://rubennaldos.github.io/parent-portal-connect/
   ✅ ¿Se ve la pantalla de login?

2. https://rubennaldos.github.io/parent-portal-connect/register
   ✅ ¿Se ve el formulario de registro?

3. Login con: superadmin@limacafe28.com
   ✅ ¿Redirige al panel de superadmin?

4. Login con: prueba@limacafe28.com
   ✅ ¿Redirige al dashboard de padres?
```

**Si TODO funciona → Continúa al Paso 2**
**Si algo NO funciona → Dime qué está fallando y lo arreglamos primero**

---

### PASO 2: Backup de Base de Datos (3 minutos)

1. Ve a: https://supabase.com/dashboard/project/duxqzozoahvrvqseinji
2. Click en **Database** → **Backups**
3. Click en **Create a manual backup**
4. Nombre: `backup-antes-cliente-30dic2024`
5. Click en **Backup database**

✅ **Listo. Ahora tienes un backup por si algo sale mal.**

---

### PASO 3: Configurar Workflow Seguro (5 minutos)

```bash
# En tu terminal (CMD o PowerShell):

cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect

# 1. Asegúrate de estar en main
git checkout main

# 2. Trae últimos cambios
git pull origin main

# 3. Crea rama de desarrollo
git checkout -b development

# 4. Súbela a GitHub
git push origin development

# 5. Vuelve a main
git checkout main

# ✅ Listo. Ahora tienes 2 ramas:
# - main: Para producción (cliente)
# - development: Para tu trabajo
```

---

### PASO 4: Crear Documento de Credenciales (5 minutos)

Crea un archivo llamado `CREDENCIALES_PARA_CLIENTE.txt` con esto:

```
=====================================
LIMA CAFÉ 28 - PARENT PORTAL
Sistema de Gestión de Kiosco Escolar
=====================================

🌐 LINK DE ACCESO:
https://rubennaldos.github.io/parent-portal-connect/

=====================================
CREDENCIALES DE PRUEBA
=====================================

SUPERADMIN (Acceso Total):
Email: superadmin@limacafe28.com
Contraseña: [tu contraseña]
Panel: /superadmin

PADRE DE FAMILIA (Ejemplo):
Email: prueba@limacafe28.com
Contraseña: [tu contraseña]
Panel: / (dashboard principal)

=====================================
REGISTRO DE NUEVOS PADRES
=====================================

Los padres pueden auto-registrarse en:
https://rubennaldos.github.io/parent-portal-connect/register

Pasos:
1. Llenar email y contraseña
2. Completar datos personales (DNI, teléfonos, dirección)
3. Seleccionar colegio
4. Registrar hijos
5. ¡Listo para usar!

=====================================
MÓDULOS DISPONIBLES
=====================================

✅ FUNCIONALES:
- Dashboard de Padres (ver hijos, saldo, recargas)
- Punto de Venta (POS)
- Registro de Padres y Estudiantes

🚧 PRÓXIMAMENTE:
- Cobranzas
- Menús de la Semana
- Reportes Financieros

=====================================
SOPORTE
=====================================

Programador: Alberto Naldos
WhatsApp: [tu número]
Email: [tu email]

Para reportar problemas:
- Enviar captura de pantalla
- Describir qué estabas haciendo
- Indicar con qué usuario estabas logueado
```

---

### PASO 5: Enviar al Cliente (5 minutos)

**OPCIÓN A: WhatsApp**

```
Hola [Nombre]! 👋

Ya está listo el sistema para que lo pruebes:

🌐 https://rubennaldos.github.io/parent-portal-connect/

Te adjunto un documento con las credenciales y una guía rápida.

Pruébalo y cualquier duda o mejora que necesites, me avisas.

¿Te parece bien si nos conectamos mañana para que me cuentes tu experiencia? 📞
```

**OPCIÓN B: Email**

```
Asunto: ✅ Sistema Parent Portal - Listo para Probar

Hola [Nombre],

El sistema de Lima Café 28 ya está disponible para que lo pruebes:

🌐 Link: https://rubennaldos.github.io/parent-portal-connect/

En el documento adjunto encontrarás:
- Credenciales de acceso
- Guía de uso
- Funcionalidades disponibles

Funcionalidades actuales:
✅ Dashboard de Padres
✅ Registro de Usuarios
✅ Punto de Venta (POS)
✅ Gestión de Saldo

Próximamente:
🚧 Cobranzas
🚧 Menús
🚧 Reportes

Cualquier duda o sugerencia, estoy disponible.

Saludos,
Alberto
```

---

### PASO 6: Configurar Tu Workflow (5 minutos)

Desde AHORA, cada vez que trabajes, sigue esto:

```bash
# 🌅 AL EMPEZAR EL DÍA

# 1. Ir a carpeta del proyecto
cd C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect

# 2. Ir a rama de desarrollo
git checkout development

# 3. Traer últimos cambios
git pull origin development

# 4. Crear rama para nueva funcionalidad
git checkout -b feature/nombre-de-lo-que-haras

# 5. Iniciar servidor
npm run dev

# 💻 TRABAJAR NORMAL
# (Editar código, probar, etc.)

# 💾 GUARDAR PROGRESO (cada 30 min)
git add .
git commit -m "feat: descripción del cambio"
git push origin feature/nombre-de-lo-que-haras

# ✅ AL TERMINAR LA FUNCIONALIDAD

# 1. Probar que todo funcione
npm run build

# 2. Merge a development
git checkout development
git merge feature/nombre-de-lo-que-haras
git push origin development

# 3. Borrar la rama de feature (ya no la necesitas)
git branch -d feature/nombre-de-lo-que-haras

# 🚀 PUBLICAR EN PRODUCCIÓN (cuando quieras)

# 1. Ir a main
git checkout main

# 2. Traer cambios
git pull origin main

# 3. Merge desde development
git merge development

# 4. Subir a GitHub
git push origin main

# 5. Esperar 2-3 minutos
# Los cambios estarán en: https://rubennaldos.github.io/parent-portal-connect/
```

---

## 📋 RESUMEN DE RAMAS

```
main
  ↑
  │ Solo haces merge cuando todo esté probado
  │
development
  ↑
  │ Aquí mergeas tus features
  │
feature/menus-tab (tu trabajo diario)
feature/pagos-dashboard (tu trabajo diario)
fix/bug-login (arreglos)
```

---

## 🎯 REGLA DE ORO

**❌ NUNCA trabajes directamente en `main`**
**✅ SIEMPRE trabaja en ramas separadas**

```bash
# ❌ MALO:
git checkout main
# (editar código)
git push origin main

# ✅ BUENO:
git checkout -b feature/mi-cambio
# (editar código)
git checkout development
git merge feature/mi-cambio
# (cuando esté listo)
git checkout main
git merge development
```

---

## 🆘 SI ALGO SALE MAL

### Error: "Subí código roto a main"

```bash
# Ver historial
git log --oneline

# Volver al commit anterior (copia el ID)
git reset --hard ID_DEL_COMMIT_BUENO

# Forzar push (SOLO en emergencias)
git push origin main --force
```

### Error: "Borré algo importante"

```bash
# Ver qué borraste
git status

# Recuperar archivo
git checkout HEAD -- nombre_del_archivo.tsx

# O recuperar TODO
git reset --hard HEAD
```

### Error: "No sé en qué rama estoy"

```bash
# Ver ramas
git branch

# La que tenga * es en la que estás

# Cambiar a main
git checkout main
```

---

## ✅ CHECKLIST FINAL

Marca cada uno cuando lo completes:

- [ ] ✅ Verifiqué que producción funciona
- [ ] ✅ Hice backup de Supabase
- [ ] ✅ Creé rama `development`
- [ ] ✅ Creé documento de credenciales
- [ ] ✅ Envié el link al cliente
- [ ] ✅ Entiendo el nuevo workflow

**Cuando termines todo, avísame y te doy el siguiente paso.**

---

## 🎓 ¿DUDAS?

**"¿Cuándo hago merge a main?"**
→ Solo cuando una funcionalidad esté 100% completa y probada.

**"¿Puedo tener varias ramas de feature al mismo tiempo?"**
→ Sí, pero enfócate en una a la vez para no confundirte.

**"¿Qué pasa si el cliente reporta un bug?"**
→ Créalo directamente desde main:
```bash
git checkout main
git checkout -b hotfix/nombre-del-bug
# (arreglar)
git checkout main
git merge hotfix/nombre-del-bug
git push origin main
```

**"¿Cada cuánto subo cambios a producción?"**
→ Tú decides. Puede ser diario, semanal, o cuando termines una funcionalidad.

---

**¡Estás listo para trabajar profesionalmente! 🚀**


