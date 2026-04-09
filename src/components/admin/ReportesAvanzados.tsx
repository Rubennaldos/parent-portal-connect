/**
 * ReportesAvanzados — Selector de reportes ejecutivos.
 * Solo accesible para admin_general / superadmin.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReporteVentasPeriodo } from '@/components/admin/reports/ReporteVentasPeriodo';
import { ReporteItemizado } from '@/components/admin/reports/ReporteItemizado';
import { ReporteArqueo } from '@/components/admin/reports/ReporteArqueo';
import {
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  ClipboardList,
  ChevronRight,
  BarChart2,
  Lock,
  Sparkles,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ReportType =
  | 'ventas_periodo'
  | 'almuerzos'
  | 'recargas'
  | 'arqueo_caja';

interface ReportCard {
  id:          ReportType;
  title:       string;
  description: string;
  icon:        React.ElementType;
  gradient:    string;
  iconBg:      string;
  iconColor:   string;
  badge?:      string;
  badgeColor?: string;
  available:   boolean;
}

const REPORTS: ReportCard[] = [
  {
    id:          'ventas_periodo',
    title:       'Ventas por Período',
    description: 'Desglose detallado de ventas diarias, semanales y mensuales por sede, cajero y medio de pago.',
    icon:        TrendingUp,
    gradient:    'from-emerald-50 to-teal-50',
    iconBg:      'bg-emerald-100',
    iconColor:   'text-emerald-600',
    badge:       'Disponible',
    badgeColor:  'bg-emerald-100 text-emerald-700',
    available:   true,
  },
  {
    id:          'almuerzos',
    title:       'Ventas Itemizadas (Productos)',
    description: 'Ranking de productos vendidos: cantidad, revenue, precio promedio y mínimo. Agrupado en servidor para máximo rendimiento.',
    icon:        UtensilsCrossed,
    gradient:    'from-amber-50 to-orange-50',
    iconBg:      'bg-amber-100',
    iconColor:   'text-amber-600',
    badge:       'Disponible',
    badgeColor:  'bg-emerald-100 text-emerald-700',
    available:   true,
  },
  {
    id:          'recargas',
    title:       'Kardex e Inventario',
    description: 'Movimientos de stock por producto: ventas POS, ajustes de merma, entradas de compra y stock actual en tiempo real.',
    icon:        Wallet,
    gradient:    'from-blue-50 to-indigo-50',
    iconBg:      'bg-blue-100',
    iconColor:   'text-blue-600',
    badge:       'Disponible',
    badgeColor:  'bg-emerald-100 text-emerald-700',
    available:   true,
  },
  {
    id:          'arqueo_caja',
    title:       'Arqueo de Caja',
    description: 'Cierre diario de caja: ingresos por medio de pago, diferencias, apertura/cierre por cajero.',
    icon:        ClipboardList,
    gradient:    'from-violet-50 to-purple-50',
    iconBg:      'bg-violet-100',
    iconColor:   'text-violet-600',
    badge:       'Disponible',
    badgeColor:  'bg-emerald-100 text-emerald-700',
    available:   true,
  },
];

// ── Componente principal ───────────────────────────────────────────────────────

interface ReportesAvanzadosProps {
  /** Si se pasa, activa directamente ese reporte al montar */
  initialReport?: ReportType | null;
  schoolId?: string | null;
}

export function ReportesAvanzados({ initialReport = null, schoolId }: ReportesAvanzadosProps) {
  const [activeReport, setActiveReport] = useState<ReportType | null>(initialReport);

  // Mientras no existe el componente del reporte, se muestra el selector
  if (!activeReport) {
    return <ReportSelector onSelect={setActiveReport} />;
  }

  return (
    <ReportViewer
      reportType={activeReport}
      schoolId={schoolId}
      onBack={() => setActiveReport(null)}
    />
  );
}

// ── Selector ──────────────────────────────────────────────────────────────────

function ReportSelector({ onSelect }: { onSelect: (r: ReportType) => void }) {
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-lg">
        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
          <BarChart2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold">Reportes Avanzados</h2>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full">
              <Lock className="w-2.5 h-2.5" />
              Admin General
            </span>
          </div>
          <p className="text-sm text-slate-300">
            Selecciona el tipo de reporte que deseas generar. Podrás configurar fechas, sedes y filtros antes de exportar.
          </p>
        </div>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORTS.map((report) => (
          <ReportCardItem
            key={report.id}
            report={report}
            onClick={() => onSelect(report.id)}
          />
        ))}
      </div>

      {/* Footer informativo */}
      <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>Los reportes se generan con los datos en tiempo real de Supabase. Puedes exportar a PDF o Excel desde cada vista.</span>
      </div>
    </div>
  );
}

// ── Tarjeta individual ────────────────────────────────────────────────────────

function ReportCardItem({
  report,
  onClick,
}: {
  report: ReportCard;
  onClick: () => void;
}) {
  const Icon = report.icon;

  return (
    <button
      onClick={onClick}
      disabled={!report.available}
      className={`group text-left w-full rounded-2xl border bg-gradient-to-br ${report.gradient} p-5
        transition-all duration-200 shadow-sm
        ${report.available
          ? 'hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 cursor-pointer active:scale-[0.98]'
          : 'opacity-60 cursor-not-allowed'
        }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${report.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${report.iconColor}`} />
        </div>
        {report.badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${report.badgeColor}`}>
            {report.badge}
          </span>
        )}
      </div>

      <h3 className="text-sm font-bold text-slate-800 mb-1.5 leading-tight">
        {report.title}
      </h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        {report.description}
      </p>

      <div className={`flex items-center gap-1 text-xs font-semibold ${report.iconColor}
        group-hover:gap-2 transition-all`}>
        {report.available ? (
          <>
            Abrir reporte
            <ChevronRight className="w-3.5 h-3.5" />
          </>
        ) : (
          <>
            <Lock className="w-3 h-3" />
            Próximamente
          </>
        )}
      </div>
    </button>
  );
}

// ── Visor de reporte ──────────────────────────────────────────────────────────

const REPORT_META: Record<ReportType, { title: string; icon: React.ElementType; color: string }> = {
  ventas_periodo:   { title: 'Ventas por Período',         icon: TrendingUp,      color: 'text-emerald-600' },
  almuerzos:        { title: 'Ventas Itemizadas',           icon: UtensilsCrossed, color: 'text-amber-600'   },
  recargas:         { title: 'Kardex e Inventario',         icon: Wallet,          color: 'text-blue-600'    },
  arqueo_caja:      { title: 'Arqueo de Caja',              icon: ClipboardList,   color: 'text-violet-600'  },
};

function ReportViewer({
  reportType,
  schoolId,
  onBack,
}: {
  reportType: ReportType;
  schoolId?: string | null;
  onBack: () => void;
}) {
  const meta = REPORT_META[reportType];
  const Icon = meta.icon;

  return (
    <div className="space-y-4">
      {/* Breadcrumb / Back */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-slate-500">
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Todos los reportes
        </Button>
        <span className="text-slate-300">/</span>
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${meta.color}`} />
          <span className="text-sm font-semibold text-slate-700">{meta.title}</span>
        </div>
      </div>

      {/* ── Reporte 1: Ventas por Período ── */}
      {reportType === 'ventas_periodo' && (
        <ReporteVentasPeriodo schoolId={schoolId} />
      )}

      {/* ── Reportes 3 y 4: Itemizado (Ventas Producto + Kardex) ── */}
      {(reportType === 'almuerzos' || reportType === 'recargas') && (
        <ReporteItemizado schoolId={schoolId} />
      )}

      {/* ── Reporte 5: Arqueo de Caja ── */}
      {reportType === 'arqueo_caja' && (
        <ReporteArqueo schoolId={schoolId} />
      )}
    </div>
  );
}
