import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
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

    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
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
    if (!supabase) {
      return {
        error: {
          name: "AuthError",
          message:
            "La autenticación no está configurada (revisa tus Secrets/variables de entorno).",
        } as AuthError,
      };
    }

    const redirectUrl = `${window.location.origin}/parent-portal-connect/#/`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return { error };
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
      
      // 4. Redirigir a login
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error signing out:', error);
      // Aún así, forzar redirección
      window.location.href = '/auth';
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
