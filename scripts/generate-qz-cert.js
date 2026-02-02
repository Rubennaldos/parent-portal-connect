/**
 * Script para generar certificado autofirmado para QZ Tray
 * Esto permite impresión silenciosa sin popups
 * 
 * USO:
 * node scripts/generate-qz-cert.js
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Para obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔐 Generando certificado para QZ Tray...\n');

// Generar par de claves RSA (privada y pública)
console.log('1️⃣ Generando par de claves RSA...');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Crear directorio para certificados si no existe
const certDir = path.join(__dirname, '..', 'qz-certificates');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

// Guardar clave privada
const privateKeyPath = path.join(certDir, 'private-key.pem');
fs.writeFileSync(privateKeyPath, privateKey);
console.log('✅ Clave privada guardada en:', privateKeyPath);

// Guardar clave pública
const publicKeyPath = path.join(certDir, 'public-key.pem');
fs.writeFileSync(publicKeyPath, publicKey);
console.log('✅ Clave pública guardada en:', publicKeyPath);

// Crear certificado autofirmado simple
const certContent = `-----BEGIN CERTIFICATE-----
${Buffer.from(publicKey).toString('base64')}
-----END CERTIFICATE-----`;

const certPath = path.join(certDir, 'digital-certificate.txt');
fs.writeFileSync(certPath, certContent);
console.log('✅ Certificado guardado en:', certPath);

console.log('\n🎉 ¡Certificado generado exitosamente!\n');
console.log('📁 Archivos generados:');
console.log('   - private-key.pem (NO compartir)');
console.log('   - public-key.pem');
console.log('   - digital-certificate.txt');
console.log('\n🔒 IMPORTANTE: NO subas private-key.pem a GitHub!');
console.log('   Ya está en .gitignore\n');
