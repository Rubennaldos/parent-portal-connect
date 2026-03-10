import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserProfileMenu } from '@/components/admin/UserProfileMenu';
import {
  FileText, ArrowLeft, Receipt, Settings, BarChart3,
  Loader2, AlertCircle, Building2, Download, BookOpen,
} from 'lucide-react';

import { InvoicesList } from '@/components/billing/InvoicesList';
import { BillingNubefactConfig } from '@/components/billing/BillingNubefactConfig';

// ── Resumen estadístico ──────────────────────────────────────────────────────
const InvoiceSummary = () => {
  const { role } = useRole();
  const [stats, setStats] = useState({
    totalEmitido: 0, totalIGV: 0,
    boletas: 0, facturas: 0, notas: 0,
    aceptadas: 0, rechazadas: 0, pendientes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    const [year, m] = month.split('-');
    const start = `${year}-${m}-01`;
    const end   = new Date(Number(year), Number(m), 0).toISOString().split('T')[0];

    supabase
      .from('invoices')
      .select('invoice_type, sunat_status, total_amount, igv_amount')
      .gte('emission_date', start)
      .lte('emission_date', end)
      .then(({ data }) => {
        const rows = data || [];
        setStats({
          totalEmitido: rows.filter(r => r.sunat_status === 'accepted').reduce((s, r) => s + r.total_amount, 0),
          totalIGV:     rows.filter(r => r.sunat_status === 'accepted').reduce((s, r) => s + r.igv_amount, 0),
          boletas:      rows.filter(r => r.invoice_type === 'boleta').length,
          facturas:     rows.filter(r => r.invoice_type === 'factura').length,
          notas:        rows.filter(r => r.invoice_type === 'nota_credito').length,
          aceptadas:    rows.filter(r => r.sunat_status === 'accepted').length,
          rechazadas:   rows.filter(r => r.sunat_status === 'rejected').length,
          pendientes:   rows.filter(r => r.sunat_status === 'pending' || r.sunat_status === 'processing').length,
        });
        setLoading(false);
      });
  }, [month]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-800">Resumen del Período</h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-md border border-input px-3 text-sm bg-white"
        />
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Facturado', value: `S/ ${stats.totalEmitido.toFixed(2)}`, sub: 'Solo aceptadas SUNAT', color: 'from-green-500 to-emerald-600', text: 'text-white' },
          { label: 'IGV del Período', value: `S/ ${stats.totalIGV.toFixed(2)}`, sub: 'A declarar a SUNAT', color: 'from-indigo-500 to-blue-600', text: 'text-white' },
          { label: 'Base Imponible', value: `S/ ${(stats.totalEmitido - stats.totalIGV).toFixed(2)}`, sub: 'Sin IGV', color: 'from-purple-500 to-violet-600', text: 'text-white' },
          { label: 'Documentos Emitidos', value: (stats.aceptadas + stats.rechazadas + stats.pendientes).toString(), sub: `${stats.aceptadas} aceptadas`, color: 'from-orange-500 to-amber-600', text: 'text-white' },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-xl p-4 bg-gradient-to-br ${kpi.color} shadow`}>
            <p className={`text-xs font-medium opacity-80 ${kpi.text}`}>{kpi.label}</p>
            <p className={`text-2xl font-black mt-1 ${kpi.text}`}>{kpi.value}</p>
            <p className={`text-xs mt-1 opacity-70 ${kpi.text}`}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Por tipo y por estado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-bold text-gray-700 mb-3">Por Tipo de Documento</p>
            <div className="space-y-2">
              {[
                { label: 'Boletas',         value: stats.boletas,  color: 'bg-blue-500' },
                { label: 'Facturas',        value: stats.facturas, color: 'bg-indigo-500' },
                { label: 'Notas de Crédito',value: stats.notas,    color: 'bg-orange-500' },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${row.color}`} />
                  <span className="text-sm text-gray-600 flex-1">{row.label}</span>
                  <span className="font-bold text-gray-800">{row.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-bold text-gray-700 mb-3">Por Estado SUNAT</p>
            <div className="space-y-2">
              {[
                { label: 'Aceptadas',  value: stats.aceptadas,  color: 'bg-green-500' },
                { label: 'Rechazadas', value: stats.rechazadas, color: 'bg-red-500' },
                { label: 'Pendientes', value: stats.pendientes, color: 'bg-yellow-400' },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${row.color}`} />
                  <span className="text-sm text-gray-600 flex-1">{row.label}</span>
                  <span className="font-bold text-gray-800">{row.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Guía rápida contadora */}
      <Card className="border-indigo-200 bg-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <BookOpen className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-indigo-800 mb-1">Guía para declaración mensual</p>
              <ul className="text-xs text-indigo-700 space-y-1 list-disc list-inside">
                <li>El <strong>IGV del período</strong> es lo que declaras en el PDT 621.</li>
                <li>Descarga los XML de todas las boletas/facturas aceptadas para tu archivo.</li>
                <li>Las notas de crédito reducen la base imponible del mes.</li>
                <li>Solo se cuentan los documentos con estado <strong>"Aceptada SUNAT"</strong>.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ── Página principal ─────────────────────────────────────────────────────────
const Facturacion = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { role } = useRole();
  const { full_name } = useUserProfile();
  const [activeTab, setActiveTab] = useState('resumen');
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  const ALLOWED_ROLES = ['admin_general', 'superadmin', 'contadora'];

  useEffect(() => {
    if (role) {
      setHasAccess(ALLOWED_ROLES.includes(role));
      setLoading(false);
    }
  }, [role]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center p-6">
        <Card className="max-w-sm w-full border-red-200">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Sin Acceso</h2>
            <p className="text-gray-500 text-sm mb-4">Este módulo es exclusivo para contadoras y administradores.</p>
            <Button onClick={() => navigate('/dashboard')} variant="outline">← Volver al Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tabs = [
    { id: 'resumen',      label: 'Resumen',        icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'comprobantes', label: 'Comprobantes',   icon: <FileText className="h-4 w-4" /> },
    { id: 'config_sunat', label: 'Config. SUNAT',  icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Volver</span>
            </Button>
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-indigo-600 shrink-0" />
                Facturación Electrónica
              </h1>
              <p className="text-gray-500 text-xs sm:text-sm hidden sm:block mt-0.5">
                Comprobantes SUNAT, reportes y configuración Nubefact
              </p>
            </div>
          </div>
          <div className="self-end sm:self-auto">
            <UserProfileMenu
              userEmail={user?.email || ''}
              userName={full_name || undefined}
              onLogout={signOut}
            />
          </div>
        </div>

        {/* Tabs */}
        <Card>
          <CardContent className="p-2 sm:p-6">
            {/* Tab bar */}
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-1 bg-muted p-1 rounded-lg w-max min-w-full sm:w-full sm:grid"
                style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contenido */}
            <div className="mt-4 sm:mt-6">
              {activeTab === 'resumen' && <InvoiceSummary />}
              {activeTab === 'comprobantes' && <InvoicesList />}
              {activeTab === 'config_sunat' && <BillingNubefactConfig />}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Facturacion;
