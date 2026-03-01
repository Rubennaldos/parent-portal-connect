import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) {
        console.error('❌ Error recuperando sesión:', error);
      }
      if (session) {
        setSession(session);
        setUser(session.user);
      }
      setLoading(false);
    });

    // 2. Escuchar cambios en el estado de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // 🔧 FIX: Ignorar TOKEN_REFRESHED e INITIAL_SESSION para evitar
      // re-renders y refetch innecesarios al volver a la pestaña
      if (event === 'TOKEN_REFRESHED') {
        // Solo actualizamos la sesión silenciosamente sin cambiar el user object
        console.log('[Auth] 🔄 Token refrescado silenciosamente');
        setSession((prev) => prev); // no-op, mantiene referencia
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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
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

  const signOut = async () => {
    if (!supabase) return;
    
    try {
      // 1. Cerrar sesión en Supabase
      await supabase.auth.signOut();
      
      // 2. Limpiar estado local
      setUser(null);
      setSession(null);
      
      // 3. Limpiar localStorage y sessionStorage
      localStorage.clear();
      sessionStorage.clear();
      
      // 4. Redirigir a login (sin hash, ahora usamos BrowserRouter)
      window.location.href = `${window.location.origin}/auth`;
    } catch (error) {
      console.error('Error signing out:', error);
      // Aún así, forzar redirección
      window.location.href = `${window.location.origin}/auth`;
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
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
