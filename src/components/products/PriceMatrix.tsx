import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Building2, DollarSign, Save, X, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { Loader2 } from 'lucide-react';

interface School {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  code: string;
  category: string;
  price_sale: number;
  price_cost: number;
}

interface SchoolPrice {
  school_id: string;
  price_sale: number | null;
  price_cost: number | null;
  is_available: boolean;
  is_custom: boolean; // Si tiene precio personalizado
}

interface PriceMatrixProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export const PriceMatrix = ({ isOpen, onClose, product }: PriceMatrixProps) => {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolPrices, setSchoolPrices] = useState<Map<string, SchoolPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && product) {
      fetchData();
    }
  }, [isOpen, product]);

  const fetchData = async () => {
    if (!product) return;
    
    setLoading(true);
    try {
      // Obtener todas las sedes
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, name')
        .order('name');

      if (schoolsError) throw schoolsError;

      // Obtener precios personalizados existentes para este producto
      const { data: customPrices, error: pricesError } = await supabase
        .from('product_school_prices')
        .select('*')
        .eq('product_id', product.id);

      if (pricesError) throw pricesError;

      setSchools(schoolsData || []);

      // Inicializar el Map con precios base o personalizados
      const pricesMap = new Map<string, SchoolPrice>();
      
      (schoolsData || []).forEach(school => {
        const customPrice = (customPrices || []).find(cp => cp.school_id === school.id);
        
        pricesMap.set(school.id, {
          school_id: school.id,
          price_sale: customPrice?.price_sale || null,
          price_cost: customPrice?.price_cost || null,
          is_available: customPrice?.is_available ?? true,
          is_custom: !!customPrice,
        });
      });

      setSchoolPrices(pricesMap);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la información: ' + error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePriceChange = (schoolId: string, field: 'price_sale' | 'price_cost', value: string) => {
    const newPrices = new Map(schoolPrices);
    const currentPrice = newPrices.get(schoolId)!;
    
    newPrices.set(schoolId, {
      ...currentPrice,
      [field]: value ? parseFloat(value) : null,
      is_custom: true, // Marcar como personalizado al modificar
    });
    
    setSchoolPrices(newPrices);
  };

  const handleAvailabilityToggle = (schoolId: string) => {
    const newPrices = new Map(schoolPrices);
    const currentPrice = newPrices.get(schoolId)!;
    
    newPrices.set(schoolId, {
      ...currentPrice,
      is_available: !currentPrice.is_available,
      is_custom: true,
    });
    
    setSchoolPrices(newPrices);
  };

  const handleResetSchool = (schoolId: string) => {
    const newPrices = new Map(schoolPrices);
    newPrices.set(schoolId, {
      school_id: schoolId,
      price_sale: null,
      price_cost: null,
      is_available: true,
      is_custom: false,
    });
    setSchoolPrices(newPrices);
  };

  const handleSaveAll = async () => {
    if (!product) return;

    setSaving(true);
    try {
      // Eliminar precios personalizados antiguos
      await supabase
        .from('product_school_prices')
        .delete()
        .eq('product_id', product.id);

      // Insertar solo los precios personalizados (los que fueron modificados)
      const customPricesArray = Array.from(schoolPrices.entries())
        .filter(([_, price]) => price.is_custom && (price.price_sale !== null || !price.is_available))
        .map(([schoolId, price]) => ({
          product_id: product.id,
          school_id: schoolId,
          price_sale: price.price_sale || product.price_sale,
          price_cost: price.price_cost || product.price_cost,
          is_available: price.is_available,
        }));

      if (customPricesArray.length > 0) {
        const { error: insertError } = await supabase
          .from('product_school_prices')
          .insert(customPricesArray);

        if (insertError) throw insertError;
      }

      toast({
        title: '✅ Precios actualizados',
        description: `Se guardaron los precios para ${customPricesArray.length} sede(s)`,
      });

      onClose();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar: ' + error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const getEffectivePrice = (schoolId: string, field: 'price_sale' | 'price_cost'): number => {
    const schoolPrice = schoolPrices.get(schoolId);
    if (!schoolPrice || !product) return 0;
    
    const customValue = schoolPrice[field];
    if (customValue !== null && customValue !== undefined) {
      return customValue;
    }
    
    return product[field] || 0;
  };

  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <DollarSign className="h-6 w-6 text-green-600" />
            Configurar Precios por Sede
          </DialogTitle>
          <DialogDescription>
            <strong>{product.name}</strong> (Código: {product.code})
            <br />
            <span className="text-xs text-muted-foreground">
              Precio Base: S/ {product.price_sale?.toFixed(2)} | 
              Los precios en blanco usan el precio base automáticamente
            </span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-blue-900">¿Cómo funciona?</p>
                  <ul className="list-disc list-inside text-blue-800 space-y-1 mt-1">
                    <li>Deja los campos <strong>en blanco</strong> para usar el <strong>precio base</strong> ({product.price_sale?.toFixed(2)})</li>
                    <li>Escribe un precio <strong>diferente</strong> solo en las sedes donde varíe</li>
                    <li>Desactiva el switch si el producto <strong>no está disponible</strong> en una sede</li>
                    <li>Usa el botón <Badge variant="outline" className="mx-1"><RefreshCw className="h-3 w-3" /></Badge> para restablecer una sede al precio base</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[30%]">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Sede
                      </div>
                    </TableHead>
                    <TableHead className="w-[20%]">Precio Venta</TableHead>
                    <TableHead className="w-[20%]">Precio Costo</TableHead>
                    <TableHead className="w-[15%] text-center">Disponible</TableHead>
                    <TableHead className="w-[15%] text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.map((school) => {
                    const schoolPrice = schoolPrices.get(school.id)!;
                    const isCustom = schoolPrice.is_custom;
                    const effectivePriceSale = getEffectivePrice(school.id, 'price_sale');
                    const effectivePriceCost = getEffectivePrice(school.id, 'price_cost');

                    return (
                      <TableRow key={school.id} className={isCustom ? 'bg-amber-50/50' : ''}>
                        <TableCell className="font-medium">
                          {school.name}
                          {isCustom && (
                            <Badge variant="secondary" className="ml-2 text-xs bg-amber-100 text-amber-800">
                              Personalizado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={product.price_sale?.toFixed(2)}
                              value={schoolPrice.price_sale || ''}
                              onChange={(e) => handlePriceChange(school.id, 'price_sale', e.target.value)}
                              className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                              Efectivo: S/ {effectivePriceSale.toFixed(2)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={product.price_cost?.toFixed(2)}
                              value={schoolPrice.price_cost || ''}
                              onChange={(e) => handlePriceChange(school.id, 'price_cost', e.target.value)}
                              className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                              Efectivo: S/ {effectivePriceCost.toFixed(2)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={schoolPrice.is_available}
                            onCheckedChange={() => handleAvailabilityToggle(school.id)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          {isCustom ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleResetSchool(school.id)}
                              title="Restablecer a precio base"
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              <Check className="h-3 w-3 mr-1" />
                              Base
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button onClick={handleSaveAll} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Guardar Cambios
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
