import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar, Download, Upload, Eye, EyeOff, PlayCircle, StopCircle, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface MenuItem {
  id?: string;
  date: string;
  day_name: string;
  breakfast?: string;
  snack_morning?: string;
  lunch?: string;
  snack_afternoon?: string;
  is_visible: boolean;
  school_id: string;
}

interface MenusTabProps {
  schools: Array<{id: string; name: string}>;
}

export const MenusTab = ({ schools }: MenusTabProps) => {
  const { toast } = useToast();
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [visibleUntil, setVisibleUntil] = useState<string>('');
  const [autoHideEnabled, setAutoHideEnabled] = useState(false);

  useEffect(() => {
    if (selectedSchool) {
      fetchMenus();
    }
  }, [selectedSchool]);

  const fetchMenus = async () => {
    if (!selectedSchool) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('weekly_menus')
        .select('*')
        .eq('school_id', selectedSchool)
        .order('date', { ascending: true });
      
      if (error) throw error;
      setMenus(data || []);
    } catch (error: any) {
      console.error('Error fetching menus:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    // Crear plantilla Excel con instrucciones
    const template = [
      {
        'FECHA (YYYY-MM-DD)': '2026-01-06',
        'DÍA': 'Lunes',
        'DESAYUNO': 'Pan con mantequilla + Leche',
        'REFRIGERIO MAÑANA': 'Frutas picadas',
        'ALMUERZO': 'Arroz con pollo + Ensalada',
        'REFRIGERIO TARDE': 'Galletas + Jugo',
      },
      {
        'FECHA (YYYY-MM-DD)': '2026-01-07',
        'DÍA': 'Martes',
        'DESAYUNO': 'Avena + Plátano',
        'REFRIGERIO MAÑANA': 'Yogurt',
        'ALMUERZO': 'Tallarines + Carne',
        'REFRIGERIO TARDE': 'Sandwich',
      },
    ];

    const instructions = [
      ['📋 INSTRUCCIONES PARA COMPLETAR LA PLANTILLA DE MENÚS'],
      [''],
      ['1️⃣ COLUMNA FECHA: Use formato AAAA-MM-DD (Ejemplo: 2026-01-06)'],
      ['2️⃣ COLUMNA DÍA: Lunes, Martes, Miércoles, Jueves, Viernes'],
      ['3️⃣ Complete los menús para cada momento del día'],
      ['4️⃣ Si no hay menú para un momento, déjelo en blanco'],
      ['5️⃣ Puede agregar más filas para más días (semanas completas)'],
      ['6️⃣ Guarde el archivo y súbalo al sistema'],
      [''],
      ['⚠️ IMPORTANTE:'],
      ['- Respete el formato de fecha AAAA-MM-DD'],
      ['- No modifique los nombres de las columnas'],
      ['- Los menús se mostrarán automáticamente a los padres'],
      [''],
      ['💡 EJEMPLO DE MENÚ A CONTINUACIÓN:'],
    ];

    const wb = XLSX.utils.book_new();
    
    // Hoja de instrucciones
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instrucciones');

    // Hoja de plantilla
    const wsTemplate = XLSX.utils.json_to_sheet(template);
    XLSX.utils.book_append_sheet(wb, wsTemplate, 'Menús Ejemplo');

    // Hoja en blanco para llenar
    const wsBlank = XLSX.utils.json_to_sheet([
      {
        'FECHA (YYYY-MM-DD)': '',
        'DÍA': '',
        'DESAYUNO': '',
        'REFRIGERIO MAÑANA': '',
        'ALMUERZO': '',
        'REFRIGERIO TARDE': '',
      }
    ]);
    XLSX.utils.book_append_sheet(wb, wsBlank, 'Menús Para Llenar');

    XLSX.writeFile(wb, `Plantilla_Menus_${selectedSchool || 'Escuela'}.xlsx`);
    
    toast({
      title: '✅ Plantilla Descargada',
      description: 'Completa la plantilla y súbela nuevamente',
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSchool) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[2] || workbook.SheetNames[0]]; // Usar hoja "Para Llenar" o primera
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const menusToInsert = jsonData.map((row: any) => ({
        date: row['FECHA (YYYY-MM-DD)'],
        day_name: row['DÍA'],
        breakfast: row['DESAYUNO'] || null,
        snack_morning: row['REFRIGERIO MAÑANA'] || null,
        lunch: row['ALMUERZO'] || null,
        snack_afternoon: row['REFRIGERIO TARDE'] || null,
        is_visible: true,
        school_id: selectedSchool,
      }));

      // Eliminar menús antiguos de la escuela
      await supabase.from('weekly_menus').delete().eq('school_id', selectedSchool);

      // Insertar nuevos menús
      const { error } = await supabase.from('weekly_menus').insert(menusToInsert);
      
      if (error) throw error;

      toast({
        title: '✅ Menús Importados',
        description: `${menusToInsert.length} días de menú cargados exitosamente`,
      });

      fetchMenus();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Error al importar: ' + error.message,
      });
    }

    // Reset input
    event.target.value = '';
  };

  const toggleVisibility = async (menuId: string, currentVisibility: boolean) => {
    try {
      const { error } = await supabase
        .from('weekly_menus')
        .update({ is_visible: !currentVisibility })
        .eq('id', menuId);
      
      if (error) throw error;
      
      fetchMenus();
      toast({ title: '✅ Visibilidad actualizada' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const toggleAllVisibility = async (visible: boolean) => {
    try {
      const { error } = await supabase
        .from('weekly_menus')
        .update({ is_visible: visible })
        .eq('school_id', selectedSchool);
      
      if (error) throw error;
      
      fetchMenus();
      toast({ title: visible ? '✅ Todos visibles' : '❌ Todos ocultos' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const getDayColor = (dayName: string) => {
    const colors: Record<string, string> = {
      'Lunes': 'bg-blue-100 border-blue-300',
      'Martes': 'bg-green-100 border-green-300',
      'Miércoles': 'bg-yellow-100 border-yellow-300',
      'Jueves': 'bg-purple-100 border-purple-300',
      'Viernes': 'bg-pink-100 border-pink-300',
    };
    return colors[dayName] || 'bg-gray-100 border-gray-300';
  };

  const getCurrentWeek = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Lunes
    
    const week = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      week.push(date.toISOString().split('T')[0]);
    }
    return week;
  };

  const weekDates = getCurrentWeek();
  const menusThisWeek = menus.filter(m => weekDates.includes(m.date));

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Gestión de Menús Semanales</CardTitle>
              <CardDescription>Planifica y comparte los menús con los padres</CardDescription>
            </div>
            <Button variant="outline" onClick={() => setShowInstructions(true)}>
              <AlertCircle className="h-4 w-4 mr-2" />
              Ver Instrucciones
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Seleccionar Sede */}
          <div>
            <Label>Seleccionar Sede</Label>
            <Select value={selectedSchool} onValueChange={setSelectedSchool}>
              <SelectTrigger>
                <SelectValue placeholder="Elige una sede" />
              </SelectTrigger>
              <SelectContent>
                {schools.map(school => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSchool && (
            <>
              {/* Botones de Acción */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Button onClick={downloadTemplate} variant="outline" className="w-full">
                  <Download className="h-4 w-4 mr-2" />
                  Descargar Plantilla
                </Button>
                
                <Button variant="outline" className="w-full relative" asChild>
                  <label>
                    <Upload className="h-4 w-4 mr-2" />
                    Subir Plantilla
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                </Button>

                <Button onClick={() => toggleAllVisibility(true)} variant="outline" className="w-full">
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Activar Todos
                </Button>

                <Button onClick={() => toggleAllVisibility(false)} variant="outline" className="w-full">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Desactivar Todos
                </Button>
              </div>

              {/* Control Automático */}
              <div className="border rounded-lg p-4 space-y-3 bg-blue-50">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-semibold">Desactivar Automáticamente</Label>
                    <p className="text-xs text-gray-600 mt-1">
                      Los menús se ocultarán automáticamente después de la fecha límite
                    </p>
                  </div>
                  <Switch
                    checked={autoHideEnabled}
                    onCheckedChange={setAutoHideEnabled}
                  />
                </div>
                
                {autoHideEnabled && (
                  <div>
                    <Label className="text-xs">Visible hasta (fecha límite)</Label>
                    <input
                      type="date"
                      value={visibleUntil}
                      onChange={e => setVisibleUntil(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Vista de Calendario */}
      {selectedSchool && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Menús de la Semana Actual
            </CardTitle>
            <CardDescription>
              {menusThisWeek.length > 0 
                ? `${menusThisWeek.length} días configurados` 
                : 'No hay menús para esta semana. Sube una plantilla.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {menusThisWeek.length > 0 ? (
                menusThisWeek.map(menu => (
                  <div
                    key={menu.id}
                    className={`border-2 rounded-xl p-4 ${getDayColor(menu.day_name)} ${
                      !menu.is_visible ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-lg">{menu.day_name}</h3>
                        <p className="text-xs text-gray-600">{menu.date}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleVisibility(menu.id!, menu.is_visible)}
                      >
                        {menu.is_visible ? (
                          <Eye className="h-4 w-4 text-green-600" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-gray-400" />
                        )}
                      </Button>
                    </div>

                    <div className="space-y-2 text-sm">
                      {menu.breakfast && (
                        <div>
                          <p className="font-semibold text-xs text-orange-600">☀️ Desayuno</p>
                          <p className="text-gray-700">{menu.breakfast}</p>
                        </div>
                      )}
                      {menu.snack_morning && (
                        <div>
                          <p className="font-semibold text-xs text-green-600">🍎 Refrigerio AM</p>
                          <p className="text-gray-700">{menu.snack_morning}</p>
                        </div>
                      )}
                      {menu.lunch && (
                        <div>
                          <p className="font-semibold text-xs text-red-600">🍽️ Almuerzo</p>
                          <p className="text-gray-700">{menu.lunch}</p>
                        </div>
                      )}
                      {menu.snack_afternoon && (
                        <div>
                          <p className="font-semibold text-xs text-blue-600">🥤 Refrigerio PM</p>
                          <p className="text-gray-700">{menu.snack_afternoon}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-5 text-center py-12 text-gray-400">
                  <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-semibold">No hay menús cargados</p>
                  <p className="text-sm">Descarga la plantilla, complétala y súbela</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de Instrucciones */}
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>📋 Instrucciones de Uso - Menús Semanales</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader>
                <CardTitle className="text-lg">1️⃣ Descargar Plantilla</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                Presiona "Descargar Plantilla" para obtener el archivo Excel con ejemplos e instrucciones.
              </CardContent>
            </Card>

            <Card className="bg-green-50 border-green-200">
              <CardHeader>
                <CardTitle className="text-lg">2️⃣ Completar Plantilla</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>• <strong>Fecha:</strong> Formato AAAA-MM-DD (Ej: 2026-01-06)</p>
                <p>• <strong>Día:</strong> Lunes a Viernes</p>
                <p>• <strong>Menús:</strong> Completa Desayuno, Refrigerios y Almuerzo</p>
                <p>• Puedes agregar múltiples semanas en el mismo archivo</p>
              </CardContent>
            </Card>

            <Card className="bg-purple-50 border-purple-200">
              <CardHeader>
                <CardTitle className="text-lg">3️⃣ Subir Plantilla</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                Presiona "Subir Plantilla" y selecciona tu archivo completado. Los menús aparecerán automáticamente en el calendario.
              </CardContent>
            </Card>

            <Card className="bg-yellow-50 border-yellow-200">
              <CardHeader>
                <CardTitle className="text-lg">4️⃣ Controlar Visibilidad</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>• <strong>Ojo verde:</strong> Los padres pueden ver este menú</p>
                <p>• <strong>Ojo gris:</strong> Menú oculto para padres</p>
                <p>• <strong>Desactivar Automáticamente:</strong> Configura fecha límite</p>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

