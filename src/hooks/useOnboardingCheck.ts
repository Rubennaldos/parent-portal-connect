import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Hook que verifica si un padre ha completado el onboarding
 * Si no lo ha completado, lo redirige automáticamente a /onboarding
 */
export function useOnboardingCheck() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(false); // Cambiado a false
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // ⚠️ HOOK TEMPORALMENTE DESACTIVADO
  // Para evitar bucles infinitos mientras configuramos el onboarding
  useEffect(() => {
    console.log('✅ [OnboardingCheck] Hook DESACTIVADO temporalmente');
    setIsChecking(false);
    setNeedsOnboarding(false);
  }, [user]);

  return { isChecking, needsOnboarding };
}
