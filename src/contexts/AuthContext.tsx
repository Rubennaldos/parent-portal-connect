import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isTempPassword: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  signOut: () => Promise<void>;
  clearTempPasswordFlag: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTempPassword, setIsTempPassword] = useState(false);

  useEffect(() => {
    // Si la configuración no está lista, no bloqueamos el render.
    if (!supabase) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    // 1. Verificar sesión inicial PRIMERO (antes de suscribirse a cambios)
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) {
        console.error('❌ Error recuperando sesión:', error);
      }
      if (session) {
        setSession(session);
        setUser(session.user);
        // Verificar contraseña temporal en carga inicial (ej. el padre recarga la página)
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('is_temp_password')
            .eq('id', session.user.id)
            .single();
          if (profileError) {
            console.warn('[Auth] is_temp_password no disponible en la BD:', profileError.message);
          } else if (mounted) {
            setIsTempPassword(profile?.is_temp_password === true);
          }
        } catch {
          // silencioso
        }
      }
      setLoading(false);
    });

    // 2. Escuchar cambios en el estado de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'TOKEN_REFRESHED') {
        // Actualizar TANTO session como user con el nuevo JWT.
        // Si solo se actualiza session, los componentes que lean `user` del contexto
        // siguen usando el objeto con el token expirado → requests fallidos.
        console.log('[Auth] 🔄 Token refrescado — actualizando session y user');
        setSession(session);
        setUser(session?.user ?? null);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        // Ya manejado por getSession() arriba
        return;
      }

      if (event === 'SIGNED_IN' && session) {
        setSession((prevSession) => {
          if (prevSession?.user?.id === session?.user?.id) return prevSession;
          return session;
        });
        setUser((prevUser) => {
          if (prevUser?.id === session?.user?.id) return prevUser;
          return session?.user ?? null;
        });
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setIsTempPassword(false);
        setLoading(false);
        return;
      }

      // Otros eventos: actualizar si cambió el usuario
      setSession((prevSession) => {
        if (prevSession?.user?.id === session?.user?.id) return prevSession;
        return session;
      });
      setUser((prevUser) => {
        if (prevUser?.id === session?.user?.id) return prevUser;
        return session?.user ?? null;
      });
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      return {
        error: {
          name: "AuthError",
          message:
            "La autenticación no está configurada (revisa tus Secrets/variables de entorno).",
        } as AuthError,
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Verificar si tiene contraseña temporal
    if (!error && data.user) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('is_temp_password')
          .eq('id', data.user.id)
          .single();
        if (profileError) {
          // Columna is_temp_password probablemente no existe aún en la BD
          console.warn('[Auth] No se pudo verificar is_temp_password:', profileError.message, '— Ejecuta la migración ADD_TEMP_PASSWORD_AND_FIX_USER_IDS.sql en Supabase');
          setIsTempPassword(false);
        } else {
          setIsTempPassword(profile?.is_temp_password === true);
        }
      } catch {
        setIsTempPassword(false);
      }
    }

    return { error };
  };

  const clearTempPasswordFlag = async () => {
    if (!supabase || !user) return;
    // Actualización optimista: cerrar el diálogo INMEDIATAMENTE aunque la red falle
    // El padre ya cambió su contraseña exitosamente; no puede quedarse bloqueado en el modal
    setIsTempPassword(false);
    try {
      await supabase.from('profiles').update({ is_temp_password: false }).eq('id', user.id);
    } catch {
      // Si falla, el flag en BD sigue en true — al próximo login se pedirá cambio de nuevo
      // pero al menos el padre puede usar el sistema en esta sesión
      console.warn('[Auth] No se pudo limpiar flag is_temp_password en BD. Se limpiará al próximo login.');
    }
  };

  const signUp = async (email: string, password: string, metadata: any = {}) => {
    // Debug logs comentados para mejorar performance
    // console.log('🔵 AuthContext.signUp() - INICIO');
    
    if (!supabase) {
      // console.log('❌ AuthContext: Supabase NO configurado');
      return {
        data: { user: null, session: null },
        error: {
          name: "AuthError",
          message:
            "La autenticación no está configurada (revisa tus Secrets/variables de entorno).",
        } as AuthError,
      };
    }

    // Redirigir a la raíz del portal después de confirmar email
    const redirectUrl = `${window.location.origin}/`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: metadata, // Guardar rol y otros datos en user_metadata
      },
    });
    
    // Debug logs comentados para mejorar performance
    // console.log('🔵 Respuesta de Supabase:', { data, error });
    
    return { data, error };
  };

  /**
   * Elimina SOLO las claves de autenticación de Supabase del localStorage.
   * NO borra preferencias de UI como activeStudentId, caché de menús, etc.
   * Supabase almacena sus tokens bajo claves que comienzan con "sb-".
   */
  const clearAuthData = () => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // sessionStorage sí se puede limpiar completo (solo guarda estado de navegación temporal)
      sessionStorage.clear();
    } catch {
      // silencioso — no bloquear el logout por errores de storage
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    
    try {
      // 1. Cerrar sesión en Supabase
      await supabase.auth.signOut();
      
      // 2. Limpiar estado local
      setUser(null);
      setSession(null);
      
      // 3. Borrar SOLO los tokens de Supabase — preservar preferencias de UI
      clearAuthData();
      
      // 4. Redirigir a login
      window.location.href = `${window.location.origin}/auth`;
    } catch (error) {
      console.error('Error signing out:', error);
      window.location.href = `${window.location.origin}/auth`;
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isTempPassword, signIn, signUp, signOut, clearTempPasswordFlag }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
