import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Printer, 
  Upload, 
  Save, 
  RefreshCw, 
  Image as ImageIcon,
  FileText,
  Settings2,
  CheckCircle2,
  XCircle,
  Building2,
  Eye
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface School {
  id: string;
  name: string;
}

interface PrinterConfig {
  id?: string;
  school_id: string;
  printer_name: string;
  is_active: boolean;
  logo_url: string | null;
  logo_width: number;
  logo_height: number;
  paper_width: number;
  print_header: boolean;
  print_footer: boolean;
  header_text: string;
  footer_text: string;
  business_name: string | null;
  business_address: string | null;
  business_phone: string | null;
  business_ruc: string | null;
  font_size: string;
  font_family: string;
  show_qr_code: boolean;
  show_barcode: boolean;
  auto_print: boolean;
  copies: number;
}

export function PrinterConfiguration() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [config, setConfig] = useState<PrinterConfig>({
    school_id: '',
    printer_name: 'Impresora Principal',
    is_active: true,
    logo_url: null,
    logo_width: 120,
    logo_height: 60,
    paper_width: 80,
    print_header: true,
    print_footer: true,
    header_text: 'Recibo de Compra',
    footer_text: 'Gracias por su preferencia',
    business_name: '',
    business_address: '',
    business_phone: '',
    business_ruc: '',
    font_size: 'normal',
    font_family: 'monospace',
    show_qr_code: false,
    show_barcode: false,
    auto_print: false,
    copies: 1
  });

  // Cargar sedes
  useEffect(() => {
    loadSchools();
  }, []);

  // Cargar configuración cuando se selecciona una sede
  useEffect(() => {
    if (selectedSchool) {
      loadPrinterConfig(selectedSchool);
    }
  }, [selectedSchool]);

  const loadSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setSchools(data || []);

      // Seleccionar la primera sede por defecto
      if (data && data.length > 0) {
        setSelectedSchool(data[0].id);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al cargar sedes',
        description: error.message
      });
    }
  };

  const loadPrinterConfig = async (schoolId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('printer_configs')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setConfig(data);
        setLogoPreview(data.logo_url);
      } else {
        // No existe configuración, crear una por defecto
        const school = schools.find(s => s.id === schoolId);
        setConfig({
          school_id: schoolId,
          printer_name: `Impresora ${school?.name || ''}`,
          is_active: true,
          logo_url: null,
          logo_width: 120,
          logo_height: 60,
          paper_width: 80,
          print_header: true,
          print_footer: true,
          header_text: 'Recibo de Compra',
          footer_text: 'Gracias por su preferencia',
          business_name: school?.name || '',
          business_address: '',
          business_phone: '',
          business_ruc: '',
          font_size: 'normal',
          font_family: 'monospace',
          show_qr_code: false,
          show_barcode: false,
          auto_print: false,
          copies: 1
        });
        setLogoPreview(null);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al cargar configuración',
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Archivo inválido',
        description: 'Por favor selecciona una imagen (PNG, JPG, etc.)'
      });
      return;
    }

    // Validar tamaño (máx 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Archivo muy grande',
        description: 'El logo no debe superar 2MB'
      });
      return;
    }

    setLogoFile(file);
    
    // Crear preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile || !selectedSchool) return null;

    setUploadingLogo(true);
    try {
      const fileExt = logoFile.name.split('.').pop();
      const fileName = `${selectedSchool}-${Date.now()}.${fileExt}`;
      const filePath = `printer-logos/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('school-assets')
        .upload(filePath, logoFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('school-assets')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al subir logo',
        description: error.message
      });
      return null;
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let logoUrl = config.logo_url;

      // Si hay un nuevo logo, subirlo primero
      if (logoFile) {
        const uploadedUrl = await uploadLogo();
        if (uploadedUrl) {
          logoUrl = uploadedUrl;
        }
      }

      const configData = {
        ...config,
        logo_url: logoUrl,
        school_id: selectedSchool
      };

      if (config.id) {
        // Actualizar existente
        const { error } = await supabase
          .from('printer_configs')
          .update(configData)
          .eq('id', config.id);

        if (error) throw error;
      } else {
        // Crear nuevo
        const { data, error } = await supabase
          .from('printer_configs')
          .insert([configData])
          .select()
          .single();

        if (error) throw error;
        setConfig(data);
      }

      toast({
        title: '✅ Configuración guardada',
        description: 'La configuración de impresión se ha guardado correctamente'
      });

      // Limpiar el archivo temporal
      setLogoFile(null);

      // Recargar configuración
      loadPrinterConfig(selectedSchool);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error.message
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedSchoolName = schools.find(s => s.id === selectedSchool)?.name || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con selector de sede */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                <Printer className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <CardTitle>Configuración de Impresoras</CardTitle>
                <CardDescription>
                  Configura logos, plantillas y formatos de impresión por sede
                </CardDescription>
              </div>
            </div>
            {config.is_active && (
              <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Activa
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Label className="min-w-[100px]">
              <Building2 className="h-4 w-4 inline mr-2" />
              Seleccionar Sede:
            </Label>
            <Select value={selectedSchool} onValueChange={setSelectedSchool}>
              <SelectTrigger className="max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs de configuración */}
      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">
            <Settings2 className="h-4 w-4 mr-2" />
            General
          </TabsTrigger>
          <TabsTrigger value="logo">
            <ImageIcon className="h-4 w-4 mr-2" />
            Logo
          </TabsTrigger>
          <TabsTrigger value="ticket">
            <FileText className="h-4 w-4 mr-2" />
            Formato Ticket
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="h-4 w-4 mr-2" />
            Vista Previa
          </TabsTrigger>
        </TabsList>

        {/* TAB: General */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuración General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="printer-name">Nombre de la Impresora</Label>
                  <Input
                    id="printer-name"
                    value={config.printer_name}
                    onChange={(e) => setConfig({ ...config, printer_name: e.target.value })}
                    placeholder="Ej: Impresora Principal"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paper-width">Ancho del Papel (mm)</Label>
                  <Select 
                    value={config.paper_width.toString()} 
                    onValueChange={(val) => setConfig({ ...config, paper_width: parseInt(val) })}
                  >
                    <SelectTrigger id="paper-width">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58">58mm (pequeño)</SelectItem>
                      <SelectItem value="80">80mm (estándar)</SelectItem>
                      <SelectItem value="110">110mm (grande)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="business-name">Nombre del Negocio</Label>
                  <Input
                    id="business-name"
                    value={config.business_name || ''}
                    onChange={(e) => setConfig({ ...config, business_name: e.target.value })}
                    placeholder="Nombre de la institución"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business-ruc">RUC</Label>
                  <Input
                    id="business-ruc"
                    value={config.business_ruc || ''}
                    onChange={(e) => setConfig({ ...config, business_ruc: e.target.value })}
                    placeholder="20XXXXXXXXX"
                    maxLength={11}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="business-address">Dirección</Label>
                <Textarea
                  id="business-address"
                  value={config.business_address || ''}
                  onChange={(e) => setConfig({ ...config, business_address: e.target.value })}
                  placeholder="Dirección completa de la sede"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business-phone">Teléfono</Label>
                <Input
                  id="business-phone"
                  value={config.business_phone || ''}
                  onChange={(e) => setConfig({ ...config, business_phone: e.target.value })}
                  placeholder="+51 999 999 999"
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <Label>Configuración Activa</Label>
                  <p className="text-sm text-muted-foreground">
                    Activar esta configuración para usarla en las impresiones
                  </p>
                </div>
                <Switch
                  checked={config.is_active}
                  onCheckedChange={(checked) => setConfig({ ...config, is_active: checked })}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Logo */}
        <TabsContent value="logo" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Logo de la Sede</CardTitle>
              <CardDescription>
                Sube el logo que aparecerá en los tickets de compra
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="logo-upload">Subir Logo</Label>
                    <Input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="cursor-pointer"
                    />
                    <p className="text-xs text-muted-foreground">
                      Formatos: PNG, JPG, SVG • Máx: 2MB
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="logo-width">Ancho (px)</Label>
                      <Input
                        id="logo-width"
                        type="number"
                        value={config.logo_width}
                        onChange={(e) => setConfig({ ...config, logo_width: parseInt(e.target.value) || 120 })}
                        min={50}
                        max={300}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="logo-height">Alto (px)</Label>
                      <Input
                        id="logo-height"
                        type="number"
                        value={config.logo_height}
                        onChange={(e) => setConfig({ ...config, logo_height: parseInt(e.target.value) || 60 })}
                        min={30}
                        max={200}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Vista Previa</Label>
                  <div className="border-2 border-dashed rounded-lg p-4 flex items-center justify-center min-h-[200px] bg-muted/20">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="Logo preview"
                        style={{
                          width: `${config.logo_width}px`,
                          height: `${config.logo_height}px`,
                          objectFit: 'contain'
                        }}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Sin logo</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Formato Ticket */}
        <TabsContent value="ticket" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Formato del Ticket</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Imprimir Encabezado</Label>
                    <p className="text-sm text-muted-foreground">Mostrar texto en la parte superior</p>
                  </div>
                  <Switch
                    checked={config.print_header}
                    onCheckedChange={(checked) => setConfig({ ...config, print_header: checked })}
                  />
                </div>

                {config.print_header && (
                  <div className="space-y-2 ml-4">
                    <Label htmlFor="header-text">Texto del Encabezado</Label>
                    <Input
                      id="header-text"
                      value={config.header_text}
                      onChange={(e) => setConfig({ ...config, header_text: e.target.value })}
                      placeholder="Ej: Recibo de Compra"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Imprimir Pie de Página</Label>
                    <p className="text-sm text-muted-foreground">Mostrar texto en la parte inferior</p>
                  </div>
                  <Switch
                    checked={config.print_footer}
                    onCheckedChange={(checked) => setConfig({ ...config, print_footer: checked })}
                  />
                </div>

                {config.print_footer && (
                  <div className="space-y-2 ml-4">
                    <Label htmlFor="footer-text">Texto del Pie de Página</Label>
                    <Textarea
                      id="footer-text"
                      value={config.footer_text}
                      onChange={(e) => setConfig({ ...config, footer_text: e.target.value })}
                      placeholder="Ej: Gracias por su preferencia"
                      rows={2}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="font-size">Tamaño de Fuente</Label>
                  <Select 
                    value={config.font_size} 
                    onValueChange={(val) => setConfig({ ...config, font_size: val })}
                  >
                    <SelectTrigger id="font-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Pequeña</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="large">Grande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="copies">Copias por Defecto</Label>
                  <Input
                    id="copies"
                    type="number"
                    value={config.copies}
                    onChange={(e) => setConfig({ ...config, copies: parseInt(e.target.value) || 1 })}
                    min={1}
                    max={5}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Mostrar Código QR</Label>
                    <p className="text-sm text-muted-foreground">Para validación de tickets</p>
                  </div>
                  <Switch
                    checked={config.show_qr_code}
                    onCheckedChange={(checked) => setConfig({ ...config, show_qr_code: checked })}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Mostrar Código de Barras</Label>
                    <p className="text-sm text-muted-foreground">Para escaneo de tickets</p>
                  </div>
                  <Switch
                    checked={config.show_barcode}
                    onCheckedChange={(checked) => setConfig({ ...config, show_barcode: checked })}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Impresión Automática</Label>
                    <p className="text-sm text-muted-foreground">Imprimir automáticamente después de una venta</p>
                  </div>
                  <Switch
                    checked={config.auto_print}
                    onCheckedChange={(checked) => setConfig({ ...config, auto_print: checked })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Vista Previa */}
        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vista Previa del Ticket</CardTitle>
              <CardDescription>
                Simulación de cómo se verá el ticket impreso
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center">
                <div 
                  className="bg-white text-black p-6 rounded-lg shadow-lg border-2 border-dashed"
                  style={{ 
                    width: `${config.paper_width * 3}px`,
                    fontFamily: config.font_family,
                    fontSize: config.font_size === 'small' ? '12px' : config.font_size === 'large' ? '16px' : '14px'
                  }}
                >
                  {/* Logo */}
                  {logoPreview && (
                    <div className="text-center mb-4">
                      <img
                        src={logoPreview}
                        alt="Logo"
                        style={{
                          width: `${config.logo_width}px`,
                          height: `${config.logo_height}px`,
                          margin: '0 auto',
                          objectFit: 'contain'
                        }}
                      />
                    </div>
                  )}

                  {/* Información del negocio */}
                  <div className="text-center mb-4 border-b pb-2">
                    <div className="font-bold">{config.business_name || selectedSchoolName}</div>
                    {config.business_ruc && <div className="text-xs">RUC: {config.business_ruc}</div>}
                    {config.business_address && <div className="text-xs">{config.business_address}</div>}
                    {config.business_phone && <div className="text-xs">Tel: {config.business_phone}</div>}
                  </div>

                  {/* Header */}
                  {config.print_header && (
                    <div className="text-center font-bold mb-3 text-sm">
                      {config.header_text}
                    </div>
                  )}

                  {/* Contenido del ticket (ejemplo) */}
                  <div className="space-y-1 mb-3 text-xs">
                    <div className="flex justify-between">
                      <span>Fecha:</span>
                      <span>{new Date().toLocaleString('es-PE')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ticket:</span>
                      <span>#001234</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cajero:</span>
                      <span>Usuario Demo</span>
                    </div>
                  </div>

                  <div className="border-t border-b py-2 mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span>Producto de Ejemplo</span>
                      <span>S/ 10.00</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Combo de Ejemplo</span>
                      <span>S/ 15.00</span>
                    </div>
                  </div>

                  <div className="text-right font-bold mb-3">
                    TOTAL: S/ 25.00
                  </div>

                  {/* QR o Barcode */}
                  {(config.show_qr_code || config.show_barcode) && (
                    <div className="text-center mb-3">
                      {config.show_qr_code && (
                        <div className="text-xs text-gray-500">[Código QR]</div>
                      )}
                      {config.show_barcode && (
                        <div className="text-xs text-gray-500">[Código de Barras]</div>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  {config.print_footer && (
                    <div className="text-center text-xs border-t pt-2">
                      {config.footer_text}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Botones de acción */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => loadPrinterConfig(selectedSchool)}
          disabled={saving || uploadingLogo}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Recargar
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || uploadingLogo}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {saving || uploadingLogo ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Guardar Configuración
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
