import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Register from "./pages/Register";
import Onboarding from "./pages/Onboarding";
import SuperAdmin from "./pages/SuperAdmin";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import POS from "./pages/POS";
import Kitchen from "./pages/Kitchen";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <AuthProvider>
          <Routes>
            {/* Rutas públicas */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/register" element={<Register />} />
            
            {/* Onboarding - Solo para padres nuevos */}
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute allowedRoles={['parent']}>
                  <Onboarding />
                </ProtectedRoute>
              }
            />
            
            {/* Dashboard de Padres - Solo para rol 'parent' */}
            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={['parent']}>
                  <Index />
                </ProtectedRoute>
              }
            />
            
            {/* Panel de SuperAdmin - Solo para programadores */}
            <Route
              path="/superadmin"
              element={
                <ProtectedRoute allowedRoles={['superadmin']}>
                  <SuperAdmin />
                </ProtectedRoute>
              }
            />
            
            {/* Dashboard de Módulos - Solo Admin General y roles de negocio */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={['admin_general', 'pos', 'kitchen']}>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            
            {/* Panel de Administración Legacy - Solo admin_general */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin_general']}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            
            {/* Punto de Venta - SuperAdmin, Admin General y POS */}
            <Route
              path="/pos"
              element={
                <ProtectedRoute allowedRoles={['superadmin', 'admin_general', 'pos']}>
                  <POS />
                </ProtectedRoute>
              }
            />
            
            {/* Pantalla de Cocina - SuperAdmin, Admin General y Kitchen */}
            <Route
              path="/kitchen"
              element={
                <ProtectedRoute allowedRoles={['superadmin', 'admin_general', 'kitchen']}>
                  <Kitchen />
                </ProtectedRoute>
              }
            />
            
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
