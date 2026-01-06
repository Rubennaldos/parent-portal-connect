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
import Comedor from "./pages/Comedor";
import SalesList from "./pages/SalesList";
import Cobranzas from "./pages/Cobranzas";
import Products from "./pages/Products";
import ParentsManagement from "./components/admin/ParentsManagement";
import AccessControl from "./pages/AccessControl";
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
                <ProtectedRoute allowedRoles={[
                  'admin_general', 
                  'supervisor_red', 
                  'gestor_unidad', 
                  'operador_caja', 
                  'operador_cocina'
                ]}>
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
            
            {/* Punto de Venta - SuperAdmin, Admin General y Operadores de Caja */}
            <Route
              path="/pos"
              element={
                <ProtectedRoute allowedRoles={['superadmin', 'admin_general', 'operador_caja']}>
                  <POS />
                </ProtectedRoute>
              }
            />
            
            {/* Lista de Ventas - Admin General y Operadores de Caja */}
            <Route
              path="/sales"
              element={
                <ProtectedRoute allowedRoles={['admin_general', 'operador_caja']}>
                  <SalesList />
                </ProtectedRoute>
              }
            />

            {/* Cobranzas - Admin General y Gestor de Unidad */}
            <Route
              path="/cobranzas"
              element={
                <ProtectedRoute allowedRoles={['admin_general', 'gestor_unidad']}>
                  <Cobranzas />
                </ProtectedRoute>
              }
            />
            
            {/* Pantalla de Comedor - SuperAdmin, Admin General y Operadores de Cocina */}
            <Route
              path="/comedor"
              element={
                <ProtectedRoute allowedRoles={['superadmin', 'admin_general', 'operador_cocina']}>
                  <Comedor />
                </ProtectedRoute>
              }
            />
            
            {/* Configuración de Padres - Admin General */}
            <Route
              path="/parents"
              element={
                <ProtectedRoute allowedRoles={['superadmin', 'admin_general']}>
                  <ParentsManagement />
                </ProtectedRoute>
              }
            />
            
            {/* Control de Acceso - Admin General */}
            <Route
              path="/access-control"
              element={
                <ProtectedRoute allowedRoles={['admin_general']}>
                  <AccessControl />
                </ProtectedRoute>
              }
            />
            
            {/* Productos - Admin General y roles con permiso */}
            <Route
              path="/products"
              element={
                <ProtectedRoute allowedRoles={['admin_general', 'supervisor_red', 'gestor_unidad']}>
                  <Products />
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
