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
  const [isChecking, setIsChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    async function checkOnboarding() {
      if (!user) {
        setIsChecking(false);
        return;
      }

      try {
        // Verificar si el usuario es padre
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        // Si no es padre, no necesita onboarding
        if (profile.role !== 'parent') {
          setNeedsOnboarding(false);
          setIsChecking(false);
          return;
        }

        // Verificar si tiene perfil de padre y si completó el onboarding
        const { data: parentProfile, error: parentError } = await supabase
          .from('parent_profiles')
          .select('onboarding_completed')
          .eq('user_id', user.id)
          .single();

        if (parentError) {
          // Si no tiene perfil de padre, necesita onboarding
          if (parentError.code === 'PGRST116') {
            setNeedsOnboarding(true);
            setIsChecking(false);
            navigate('/onboarding', { replace: true });
            return;
          }
          throw parentError;
        }

        // Si no completó el onboarding, redirigir
        if (!parentProfile.onboarding_completed) {
          setNeedsOnboarding(true);
          setIsChecking(false);
          navigate('/onboarding', { replace: true });
          return;
        }

        setNeedsOnboarding(false);
        setIsChecking(false);
      } catch (error) {
        console.error('Error checking onboarding:', error);
        setIsChecking(false);
      }
    }

    checkOnboarding();
  }, [user, navigate]);

  return { isChecking, needsOnboarding };
}

