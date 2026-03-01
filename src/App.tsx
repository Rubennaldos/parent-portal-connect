import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionProtectedRoute } from "@/components/PermissionProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Teacher from "./pages/Teacher";
// Eliminamos imports innecesarios para simplificar
import SuperAdmin from "./pages/SuperAdmin";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import POS from "./pages/POS";
import Comedor from "./pages/Comedor";
import SalesList from "./pages/SalesList";
import Cobranzas from "./pages/Cobranzas";
import Finanzas from "./pages/Finanzas";
import ParentConfiguration from "./pages/ParentConfiguration";
import Products from "./pages/Products";
import PaymentStats from "./pages/PaymentStats";
import LunchCalendar from "./pages/LunchCalendar";
import Logistics from "./pages/Logistics";
import SchoolAdmin from "./pages/SchoolAdmin";
import AccessControl from "./pages/AccessControl";
import CombosPromotions from "./pages/CombosPromotions";
import CashRegisterPage from "./pages/CashRegister";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 🔧 FIX: Evitar refetch automático al volver a la pestaña
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutos
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ErrorBoundary>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
            {/* Única puerta de entrada: Auth unificado */}
            <Route path="/auth" element={<Auth />} />
            
            {/* Redirecciones de rutas antiguas para no romper nada */}
            <Route path="/register" element={<Navigate to="/auth" replace />} />
            <Route path="/onboarding" element={<Navigate to="/auth" replace />} />
            
            {/* Dashboard de Padres - Solo para rol 'parent' */}
            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={['parent']}>
                  <Index />
                </ProtectedRoute>
              }
            />
            
            {/* Portal de Profesores - Solo para rol 'teacher' */}
            <Route
              path="/teacher"
              element={
                <ProtectedRoute allowedRoles={['teacher']}>
                  <Teacher />
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

            {/* Finanzas/Tesorería - Admin General y Superadmin */}
            <Route
              path="/finanzas"
              element={
                <ProtectedRoute allowedRoles={['admin_general', 'superadmin']}>
                  <Finanzas />
                </ProtectedRoute>
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
                  <ParentConfiguration />
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
            
            {/* Logística y Almacén - Basado en permisos dinámicos */}
            <Route
              path="/logistics"
              element={
                <PermissionProtectedRoute moduleCode="logistica">
                  <Logistics />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Administración de Sede - Basado en permisos dinámicos */}
            <Route
              path="/school-admin"
              element={
                <PermissionProtectedRoute moduleCode="admin_sede">
                  <SchoolAdmin />
                </PermissionProtectedRoute>
              }
            />
            
            {            /* Combos y Promociones - Basado en permisos dinámicos */}
            <Route
              path="/combos-promotions"
              element={
                <PermissionProtectedRoute moduleCode="promociones">
                  <CombosPromotions />
                </PermissionProtectedRoute>
              }
            />
            
            {/* Cierre de Caja - Basado en permisos dinámicos */}
            <Route
              path="/cash-register"
              element={
                <PermissionProtectedRoute moduleCode="cash_register">
                  <CashRegisterPage />
                </PermissionProtectedRoute>
              }
            />
            
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </TooltipProvider>
</QueryClientProvider>
);

export default App;
