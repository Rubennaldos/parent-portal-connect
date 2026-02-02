/**
 * Configuración simplificada de QZ Tray
 * Conexión directa sin certificados para facilitar la configuración
 */

import qz from 'qz-tray';

/**
 * Configurar certificados automáticamente
 * Usa configuración simplificada que permite "Remember this decision"
 */
export const setupQZCertificates = async () => {
  console.log('🔧 Configurando QZ Tray en modo simplificado...');
  setupQZBasic();
};

/**
 * Configuración sin certificados (permite "Remember this decision")
 * Usa firma vacía para permitir que QZ Tray guarde la preferencia
 * 
 * IMPORTANTE: La primera vez aparecerá un popup de QZ Tray.
 * Debes marcar "Remember this decision" y dar "Allow" para que no vuelva a aparecer.
 */
export const setupQZBasic = () => {
  // Configuración que permite conexiones anónimas pero recordables
  qz.security.setCertificatePromise(function(resolve, reject) {
    // Resolver sin certificado - QZ Tray permitirá "Remember"
    resolve();
  });
  
  // Firma simple que retorna vacío
  qz.security.setSignaturePromise(function(toSign) {
    return function(resolve, reject) {
      // Firma vacía - QZ Tray manejará esto
      resolve();
    };
  });
  
  console.log('✅ QZ Tray configurado en modo básico');
  console.log('ℹ️  Si aparece popup: marca "Remember this decision" y da "Allow"');
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
