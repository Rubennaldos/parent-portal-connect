/**
 * generate-version.mjs
 *
 * PROPÓSITO:
 *   Fuente única de verdad (SSOT) del versionado de la PWA.
 *   Se ejecuta como hook "prebuild" (antes de `vite build`) y escribe
 *   public/version.json. Vite copia public/ → dist/ automáticamente,
 *   por lo que Vercel sirve el archivo como estático sin rewrite.
 *
 * REGLAS:
 *   - La versión semántica proviene EXCLUSIVAMENTE de src/config/app.config.ts.
 *   - Cada build produce un identificador único: semver + timestamp de build.
 *     Esto garantiza que dos deploys del mismo semver sean distinguibles
 *     (escenario real: hotfix que no bumpeó la versión).
 *   - Fail-fast: si no puede leer la versión o escribir el archivo, sale
 *     con código 1 y aborta el build de Vite. Cero builds silenciosamente rotos.
 *   - No usa dependencias externas: solo Node.js built-ins (fs, path, url).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── 1. Leer version desde app.config.ts ──────────────────────────────────────
const configPath = resolve(ROOT, 'src', 'config', 'app.config.ts');

if (!existsSync(configPath)) {
  console.error(`[generate-version] FATAL: no se encontró ${configPath}`);
  process.exit(1);
}

const configSource = readFileSync(configPath, 'utf-8');

// Extrae el valor del campo 'version' del objeto APP_CONFIG.
// Formato esperado: version: '1.9.1',   (comillas simples o dobles, espacios opcionales)
const versionMatch = configSource.match(/version\s*:\s*['"](\d+\.\d+\.\d+)['"]/);

if (!versionMatch) {
  console.error(
    '[generate-version] FATAL: no se pudo extraer la versión de app.config.ts.\n' +
    '  Formato esperado en APP_CONFIG: version: \'X.Y.Z\'\n' +
    `  Contenido leído:\n${configSource}`
  );
  process.exit(1);
}

const semver    = versionMatch[1];
const buildTime = new Date().toISOString();
// El identificador completo es "semver+timestamp".
// El VersionChecker compara este string completo: mismo semver, distinto timestamp → nuevo deploy.
const version   = `${semver}+${Date.now()}`;

// ── 2. Escribir public/version.json ──────────────────────────────────────────
const outPath = resolve(ROOT, 'public', 'version.json');
const payload = JSON.stringify({ version, semver, buildTime }, null, 2);

try {
  writeFileSync(outPath, payload, 'utf-8');
} catch (err) {
  console.error(`[generate-version] FATAL: no se pudo escribir ${outPath}:\n${err.message}`);
  process.exit(1);
}

// ── 3. Verificación de integridad post-escritura (fail-fast) ─────────────────
try {
  const written = JSON.parse(readFileSync(outPath, 'utf-8'));
  if (written.version !== version) {
    throw new Error(`versión escrita (${written.version}) no coincide con la esperada (${version})`);
  }
} catch (err) {
  console.error(`[generate-version] FATAL: verificación post-escritura falló:\n${err.message}`);
  process.exit(1);
}

// ── 4. Log de confirmación (visible en CI / Vercel build logs) ───────────────
console.log(`[generate-version] ✅ public/version.json generado`);
console.log(`  semver    : ${semver}`);
console.log(`  version   : ${version}`);
console.log(`  buildTime : ${buildTime}`);
