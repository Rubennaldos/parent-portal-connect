import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionProtectedRoute } from "@/components/PermissionProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import PaymentStats from "./pages/PaymentStats";
import LunchCalendar from "./pages/LunchCalendar";
import ParentsManagement from "./components/admin/ParentsManagement";
import AccessControl from "./pages/AccessControl";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ErrorBoundary>
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
            
            {/* Punto de Venta - Basado en permisos dinámicos */}
            <Route
              path="/pos"
              element={
                <PermissionProtectedRoute moduleCode="pos">
                  <POS />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Lista de Ventas - Basado en permisos dinámicos */}
            <Route
              path="/sales"
              element={
                <PermissionProtectedRoute moduleCode="ventas">
                  <SalesList />
                </PermissionProtectedRoute>
              }
            />

            {/* Cobranzas - Basado en permisos dinámicos */}
            <Route
              path="/cobranzas"
              element={
                <PermissionProtectedRoute moduleCode="cobranzas">
                  <Cobranzas />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Pantalla de Comedor - Basado en permisos dinámicos */}
            <Route
              path="/comedor"
              element={
                <PermissionProtectedRoute moduleCode="comedor">
                  <Comedor />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Configuración de Padres - Basado en permisos dinámicos */}
            <Route
              path="/parents"
              element={
                <PermissionProtectedRoute moduleCode="config_padres">
                  <ParentsManagement />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Control de Acceso - Solo Admin General (siempre) */}
            <Route
              path="/access-control"
              element={
                <ProtectedRoute allowedRoles={['admin_general']}>
                  <AccessControl />
                </ProtectedRoute>
              }
            />
            
            {/* Productos - Basado en permisos dinámicos */}
            <Route
              path="/products"
              element={
                <PermissionProtectedRoute moduleCode="productos">
                  <Products />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Estadísticas de Pagos - Solo Admin General */}
            <Route
              path="/payment-stats"
              element={
                <ProtectedRoute allowedRoles={['admin_general']}>
                  <PaymentStats />
                </ProtectedRoute>
              }
            />
            
            {/* Calendario de Almuerzos - Basado en permisos dinámicos */}
            <Route
              path="/lunch-calendar"
              element={
                <PermissionProtectedRoute moduleCode="almuerzos">
                  <LunchCalendar />
                </PermissionProtectedRoute>
              }
            />
            
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </TooltipProvider>
</QueryClientProvider>
);

export default App;
