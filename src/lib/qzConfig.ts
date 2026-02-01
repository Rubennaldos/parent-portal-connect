/**
 * Configuración de certificados para QZ Tray
 * Para habilitar la conexión segura sin pop-ups
 */

import qz from 'qz-tray';

/**
 * Descargar certificado desde QZ Tray
 * Este certificado se descarga automáticamente del servidor local de QZ Tray
 */
const fetchQZCertificate = async (): Promise<string | null> => {
  try {
    const response = await fetch('https://localhost:8181/cert', {
      method: 'GET',
      mode: 'cors'
    });
    
    if (response.ok) {
      const cert = await response.text();
      console.log('✅ Certificado de QZ Tray descargado');
      return cert;
    }
  } catch (error) {
    console.warn('⚠️ No se pudo descargar certificado automáticamente:', error);
  }
  
  return null;
};

/**
 * Configurar certificados automáticamente
 * Intenta descargar el certificado de QZ Tray primero
 */
export const setupQZCertificates = async () => {
  try {
    const cert = await fetchQZCertificate();
    
    if (cert) {
      qz.security.setCertificatePromise(function(resolve) {
        resolve(cert);
      });
      console.log('✅ Certificados QZ Tray configurados automáticamente');
    } else {
      // Fallback: sin certificado
      setupQZBasic();
    }
  } catch (error) {
    console.warn('⚠️ Error al configurar certificados, usando modo básico');
    setupQZBasic();
  }
};

/**
 * Configuración sin certificados (permite "Remember this decision")
 * Usa firma vacía para permitir que QZ Tray guarde la preferencia
 */
export const setupQZBasic = () => {
  // Configuración que permite conexiones anónimas pero recordables
  qz.security.setCertificatePromise(function(resolve, reject) {
    // Resolver sin certificado - QZ Tray permitirá "Remember"
    resolve();
  });

  // NO establecer algoritmo de firma - usar por defecto de QZ
  // qz.security.setSignatureAlgorithm("SHA512");
  
  // Firma simple que retorna vacío
  qz.security.setSignaturePromise(function(toSign) {
    return function(resolve, reject) {
      // Firma vacía - QZ Tray manejará esto
      resolve();
    };
  });
  
  console.log('✅ QZ Tray configurado en modo básico (permite Remember)');
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
