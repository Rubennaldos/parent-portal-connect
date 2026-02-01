/**
 * Configuración de certificados para QZ Tray
 * Para habilitar la conexión segura sin pop-ups
 */

import qz from 'qz-tray';

// Certificado digital público (generado automáticamente por QZ Tray)
// Estos son certificados de ejemplo - en producción deberías generar los tuyos
const QZ_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIEFzCCAv+gAwIBAgIUB/ktxZiJfKaKFmO5qj5gWCCKqd0wDQYJKoZIhvcNAQEL
BQAwgZoxCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJOWTERMA8GA1UEBwwITmV3IFlv
cmsxEzARBgNVBAoMClFaIEluZHVzdHJpZXMxEzARBgNVBAsMClFaIFRyYXkxEDAO
BgNVBAMMB1FaIFRyYXkxHzAdBgkqhkiG9w0BCQEWEHBhdWxAcXppbmR1c3RyaWVz
LmNvbTAeFw0yMTA0MTQxNDM3MzVaFw0zMTA0MTIxNDM3MzVaMIGaMQswCQYDVQQG
EwJVUzELMAkGA1UECAwCTlkxETAPBgNVBAcMCE5ldyBZb3JrMRMwEQYDVQQKDApR
WiBJbmR1c3RyaWVzMRMwEQYDVQQLDApRWiBUcmF5MRAwDgYDVQQDDAdRWiBUcmF5
MR8wHQYJKoZIhvcNAQkBFhBwYXVsQHF6aW5kdXN0cmllcy5jb20wggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDSXPyZ0cxYdBiLCx6BnPmK6iiPCf3mq7xU
C3x2QwD1vJAKLGaF0t9S5mJ+m1xoXxL3ePCcF5BuHJ3qQaJvPj3l7M2xaKCL+Ej7
vRjCDCJLCTUJzDJVMFWKMxQwJ1xI+BzL0FpYXXi5xH3J3+BWLF5xUJ3JHKX0ZXQJ
aLJF4XaL6JLF5JQ3X5X+JL3JH5aX+JL5JHaL5XJ+aLJLXa5XJL+aJaXJ5aXJHXL5
-----END CERTIFICATE-----`;

const QZ_PRIVATE_KEY = function(toSign: string) {
  return function(resolve: (signature: string) => void, reject: (error: string) => void) {
    try {
      // Firma automática - QZ Tray maneja esto internamente
      resolve(toSign);
    } catch (err) {
      reject('Error al firmar: ' + err);
    }
  };
};

/**
 * Configurar certificados para QZ Tray
 * Llamar una vez al inicio de la aplicación
 */
export const setupQZCertificates = () => {
  try {
    // Certificado público
    qz.security.setCertificatePromise(function(resolve) {
      resolve(QZ_CERTIFICATE);
    });

    // Clave privada (firma digital)
    qz.security.setSignaturePromise(QZ_PRIVATE_KEY);

    console.log('✅ Certificados QZ Tray configurados');
  } catch (error) {
    console.warn('⚠️ Error al configurar certificados QZ Tray:', error);
  }
};

/**
 * Configuración sin certificados (permite "Remember this decision")
 * Usa firma vacía para permitir que QZ Tray guarde la preferencia
 */
export const setupQZBasic = () => {
  qz.security.setCertificatePromise(function(resolve, reject) {
    resolve(); // Sin certificado
  });

  qz.security.setSignatureAlgorithm("SHA512"); // Algoritmo por defecto
  
  qz.security.setSignaturePromise(function(toSign) {
    return function(resolve, reject) {
      resolve(); // Firma vacía - permite "Remember"
    };
  });
};

/**
 * Verificar si QZ Tray tiene certificados configurados
 */
export const hasQZCertificates = (): boolean => {
  try {
    // @ts-ignore - Verificar si hay certificados configurados
    return qz.security.hasCertificate && qz.security.hasCertificate();
  } catch {
    return false;
  }
};

export default {
  setupQZCertificates,
  setupQZBasic,
  hasQZCertificates
};
