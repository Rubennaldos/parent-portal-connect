import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
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

    // 1. Escuchar cambios en el estado de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔔 Auth Event:', event, session ? '✅ Sesión activa' : '❌ Sin sesión');
      
      // Actualizamos siempre que haya un cambio, sin importar el tipo de evento
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // 2. Verificar sesión inicial
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('❌ Error recuperando sesión:', error);
      }
      if (session) {
        setSession(session);
        setUser(session.user);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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

  const signUp = async (email: string, password: string) => {
    console.log('🔵 AuthContext.signUp() - INICIO');
    console.log('   - email:', email);
    console.log('   - supabase existe:', !!supabase);
    
    if (!supabase) {
      console.log('❌ AuthContext: Supabase NO configurado');
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
    console.log('   - redirectUrl:', redirectUrl);

    console.log('🔵 Llamando a supabase.auth.signUp()...');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    
    console.log('🔵 Respuesta de Supabase:');
    console.log('   - data:', data);
    console.log('   - error:', error);
    console.log('   - user creado:', !!data?.user);
    console.log('   - session creada:', !!data?.session);
    
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
