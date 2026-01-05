import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  DollarSign, 
  Calendar,
  Users,
  FileText,
  Settings
} from 'lucide-react';

// Importar los componentes de cada tab (los crearemos después)
import { BillingDashboard } from '@/components/billing/BillingDashboard';
import { BillingPeriods } from '@/components/billing/BillingPeriods';
import { BillingCollection } from '@/components/billing/BillingCollection';
import { BillingReports } from '@/components/billing/BillingReports';
import { BillingConfig } from '@/components/billing/BillingConfig';

const Cobranzas = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-red-600" />
              Módulo de Cobranzas
            </h1>
            <p className="text-gray-600 mt-1">
              Gestión integral de cuentas por cobrar y períodos de facturación
            </p>
          </div>
        </div>

        {/* Tabs Principal */}
        <Card>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5 h-auto">
                <TabsTrigger value="dashboard" className="flex items-center gap-2 py-3">
                  <DollarSign className="h-4 w-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                </TabsTrigger>
                <TabsTrigger value="periods" className="flex items-center gap-2 py-3">
                  <Calendar className="h-4 w-4" />
                  <span className="hidden sm:inline">Períodos</span>
                </TabsTrigger>
                <TabsTrigger value="collect" className="flex items-center gap-2 py-3">
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">Cobrar</span>
                </TabsTrigger>
                <TabsTrigger value="reports" className="flex items-center gap-2 py-3">
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">Reportes</span>
                </TabsTrigger>
                <TabsTrigger value="config" className="flex items-center gap-2 py-3">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Config</span>
                </TabsTrigger>
              </TabsList>

              {/* Dashboard Tab */}
              <TabsContent value="dashboard" className="mt-6">
                <BillingDashboard />
              </TabsContent>

              {/* Períodos Tab */}
              <TabsContent value="periods" className="mt-6">
                <BillingPeriods />
              </TabsContent>

              {/* Cobrar Tab */}
              <TabsContent value="collect" className="mt-6">
                <BillingCollection />
              </TabsContent>

              {/* Reportes Tab */}
              <TabsContent value="reports" className="mt-6">
                <BillingReports />
              </TabsContent>

              {/* Configuración Tab */}
              <TabsContent value="config" className="mt-6">
                <BillingConfig />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Cobranzas;

