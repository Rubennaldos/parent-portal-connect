import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, Merge, BadgeCheck, Package, BarChart3, CalendarRange, Activity, TruckIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { ProductMergeTab } from '@/components/logistics/ProductMergeTab';
import { ItemMasterTab } from '@/components/logistics/ItemMasterTab';
// InventoryMatrixView se conserva en código pero queda fuera de navegación de usuario.
import LogisticsDashboard from '@/components/logistics/LogisticsDashboard';
import LogisticsMovementReport from '@/components/logistics/LogisticsMovementReport';
import { MovementsHubTab } from '@/components/logistics/MovementsHubTab';
import StockRealtimeTab from '@/components/logistics/StockRealtimeTab';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
const BROWN = '#8B4513';

/** Fase 0 (2026-06-06): Comprobantes oculto — stock inmediato en submit; auditoría legacy vía RPC en BD. */
const SHOW_BRANCH_SUPPLY_AUDIT_TAB = false;

const Logistics = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const maintenance = useMaintenanceGuard('logistica_admin');
  const { canViewAllSchools } = useRole();
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setUserSchoolId(data?.school_id || null));
  }, [user]);

  // ── Mantenimiento ──────────────────────────────────────────────────────────
  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600 text-sm">{maintenance.message}</p>
          <Button size="sm" variant="outline" onClick={() => navigate('/dashboard')}>
            Volver al Panel
          </Button>
        </div>
      </div>
    );
  }

  // ── Render principal ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FDFCFB]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">

        {/* ── Header responsive ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Package className="h-6 w-6 shrink-0" style={{ color: BROWN }} />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-black text-slate-800 leading-tight truncate">
                Logística y Almacén
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                Dashboard · Stock en Tiempo Real · Ingresos y Salidas · Match · Maestro · Reportes
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/dashboard')}
            className="shrink-0 gap-1.5 text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Volver al Panel</span>
            <span className="sm:hidden">Salir</span>
          </Button>
        </div>

          {/* ── Tabs ── */}
        <Tabs defaultValue="dashboard" className="w-full">

          <div className="overflow-x-auto pb-1">
            <TabsList className={`flex w-max sm:grid sm:w-full ${SHOW_BRANCH_SUPPLY_AUDIT_TAB ? 'sm:grid-cols-7' : 'sm:grid-cols-6'} bg-white border rounded-xl p-1 gap-0.5 min-w-full`}>

              <TabsTrigger
                value="dashboard"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-slate-800 data-[state=active]:text-white"
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                <span>Dashboard</span>
              </TabsTrigger>

              <TabsTrigger
                value="stock-live"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-emerald-700 data-[state=active]:text-white"
              >
                <Activity className="h-3.5 w-3.5 shrink-0" />
                <span>Stock Live</span>
              </TabsTrigger>

              <TabsTrigger
                value="movimientos"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-teal-700 data-[state=active]:text-white"
              >
                <TruckIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Ingresos y Salidas</span>
              </TabsTrigger>

              <TabsTrigger
                value="merge"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:text-white"
              >
                <Merge className="h-3.5 w-3.5 shrink-0" />
                <span>Match</span>
              </TabsTrigger>

              <TabsTrigger
                value="master"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-green-600 data-[state=active]:text-white"
              >
                <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                <span>Maestro</span>
              </TabsTrigger>

              <TabsTrigger
                value="reportes"
                className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-blue-700 data-[state=active]:text-white"
              >
                <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                <span>Reportes</span>
              </TabsTrigger>

              {SHOW_BRANCH_SUPPLY_AUDIT_TAB && (
                <TabsTrigger
                  value="comprobantes-sede"
                  className="flex items-center gap-1 text-xs px-2 py-2 whitespace-nowrap data-[state=active]:bg-orange-700 data-[state=active]:text-white"
                >
                  <span>Comprobantes</span>
                </TabsTrigger>
              )}

            </TabsList>
          </div>

          {/* ── Contenidos ── */}

          <TabsContent value="dashboard" className="mt-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
              <LogisticsDashboard
                userSchoolId={userSchoolId}
                canViewAllSchools={canViewAllSchools}
              />
            </div>
          </TabsContent>

          <TabsContent value="stock-live" className="mt-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
              <StockRealtimeTab />
            </div>
          </TabsContent>

          <TabsContent value="movimientos" className="mt-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
              <MovementsHubTab schoolId={userSchoolId} />
            </div>
          </TabsContent>


          <TabsContent value="merge" className="mt-3">
            <ProductMergeTab />
          </TabsContent>

          <TabsContent value="master" className="mt-3">
            <ItemMasterTab />
          </TabsContent>

          <TabsContent value="reportes" className="mt-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5">
              <LogisticsMovementReport />
            </div>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
};

export default Logistics;
