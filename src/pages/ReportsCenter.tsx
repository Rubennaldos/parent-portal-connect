// Registra todos los reportes del sistema (efecto secundario intencional)
import '@/modules/reports/bootstrap';

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, ClipboardList, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BaseReportView } from '@/modules/reports/components/BaseReportView';
import { getRegisteredReports } from '@/modules/reports/registry';
import {
  SALES_REPORT_DESCRIPTION,
  SALES_REPORT_ID,
  SALES_REPORT_TITLE,
} from '@/modules/reports/features/ventas/description';

export default function ReportsCenter() {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const reports = useMemo(() => getRegisteredReports(), []);
  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const isSales = selectedReport?.id === SALES_REPORT_ID;
  const selectedTitle = isSales ? SALES_REPORT_TITLE : selectedReport?.title ?? '';
  const selectedDescription = isSales
    ? SALES_REPORT_DESCRIPTION
    : selectedReport?.description ?? '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      <main className="container mx-auto px-4 py-6 sm:py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <BarChart3 className="h-3.5 w-3.5" />
              Centro de Reportes
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Informes ejecutivos</h1>
            <p className="max-w-2xl text-sm text-slate-600">
              Selecciona un informe para entrar a su módulo especializado.
            </p>
          </div>

          <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto">
            <Link to="/dashboard" className="inline-flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver al Dashboard
            </Link>
          </Button>
        </div>

        {!selectedReport && (
          <section className="space-y-5">
            {reports.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-slate-50/80">
                <CardContent className="px-6 py-12 text-center">
                  <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">Sin reportes registrados por ahora</p>
                  <p className="mx-auto mt-2 max-w-md text-xs text-slate-500 leading-relaxed">
                    El panel de selección está listo. Cuando un módulo se registre en el registry,
                    aparecerá automáticamente aquí como tarjeta.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {reports.map((report) => {
                  const title = report.id === SALES_REPORT_ID ? SALES_REPORT_TITLE : report.title;
                  const description =
                    report.id === SALES_REPORT_ID
                      ? SALES_REPORT_DESCRIPTION
                      : (report.description ?? 'Reporte disponible.');

                  return (
                    <Card
                      key={report.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedReportId(report.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedReportId(report.id);
                        }
                      }}
                      className="group cursor-pointer border-slate-200 bg-white/90 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <CardHeader className="space-y-3">
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                          <LayoutDashboard className="h-4 w-4" />
                        </div>
                        <CardTitle className="text-base text-slate-900">{title}</CardTitle>
                        <CardDescription className="line-clamp-4 text-xs leading-relaxed text-slate-600">
                          {description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="text-xs font-medium text-indigo-700 group-hover:text-indigo-800">
                          Abrir informe →
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {selectedReport && (
          <section className="space-y-4">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="inline-flex items-center gap-2 text-slate-700"
                onClick={() => setSelectedReportId(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                Volver a Informes
              </Button>
            </div>

            <BaseReportView
              title={selectedTitle}
              description={selectedDescription}
              renderContent={(filters) => selectedReport.component({ filters })}
            />
          </section>
        )}
      </main>
    </div>
  );
}
