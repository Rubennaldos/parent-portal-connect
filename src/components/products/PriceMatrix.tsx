import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Building2, DollarSign, Save, X, Check, AlertCircle, RefreshCw, Globe, Lock } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import {
  saveProductScopeAndPrices,
  isPriceScopeRelatedError,
  getPriceScopeFriendlyToast,
  getSupabaseErrorBlob,
} from '@/services/productScopePricingService';

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
  /** null = global en BD; ausente si el padre no lo envía */
  school_ids?: string[] | null;
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

function getGenericSaveErrorDescription(err: unknown): string {
  const blob = getSupabaseErrorBlob(err);
  if (blob) return blob;
  return 'No se pudo guardar los precios.';
}

export const PriceMatrix = ({ isOpen, onClose, product }: PriceMatrixProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { role } = useRole();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolPrices, setSchoolPrices] = useState<Map<string, SchoolPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && product) {
      fetchData();
    }
  }, [isOpen, product]);

  const fetchData = async () => {
    if (!product) return;

    setLoading(true);
    try {
      // 1. Determinar la sede del usuario (gestor: solo la suya; admin/supervisor: todas)
      let userSchool: string | null = null;
      if (role !== 'admin_general' && role !== 'supervisor_red' && user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .maybeSingle();

        userSchool = profileData?.school_id || null;
        setUserSchoolId(userSchool);
      }

      // 2. Cargar sedes visibles para el usuario (admin ve todas, gestor ve solo la suya)
      let schoolsQuery = supabase
        .from('schools')
        .select('id, name')
        .order('name');

      if (userSchool) {
        schoolsQuery = schoolsQuery.eq('id', userSchool);
      }

      const [{ data: schoolsData, error: schoolsError }, { data: customPrices, error: pricesError }] =
        await Promise.all([
          schoolsQuery,
          supabase.from('product_school_prices').select('*').eq('product_id', product.id),
        ]);

      if (schoolsError) throw schoolsError;
      if (pricesError) throw pricesError;

      // 3. Prellenado inteligente: intersectar sedes del usuario con el alcance del producto.
      //    - school_ids === null  → producto global → mostrar todas las sedes del usuario.
      //    - school_ids = []     → sin sedes activas → tabla vacía.
      //    - school_ids = [a,b]  → solo mostrar esas sedes (si el usuario tiene acceso).
      const scopeIds = product.school_ids; // null | string[]
      const visibleSchools =
        scopeIds == null
          ? (schoolsData ?? [])
          : (schoolsData ?? []).filter(s => (scopeIds as string[]).includes(s.id));

      setSchools(visibleSchools);

      // 4. Construir Map de precios solo para las sedes visibles
      const pricesMap = new Map<string, SchoolPrice>();
      visibleSchools.forEach(school => {
        const customPrice = (customPrices ?? []).find(cp => cp.school_id === school.id);
        pricesMap.set(school.id, {
          school_id: school.id,
          price_sale: customPrice?.price_sale ?? null,
          price_cost: customPrice?.price_cost ?? null,
          is_available: customPrice?.is_available ?? true,
          is_custom: !!customPrice,
        });
      });

      setSchoolPrices(pricesMap);
    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la información: ' + getSupabaseErrorBlob(error),
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
      const customPricesArray = Array.from(schoolPrices.entries())
        .filter(([_, price]) => price.is_custom && (price.price_sale !== null || !price.is_available))
        .map(([schoolId, price]) => ({
          school_id: schoolId,
          price_sale: price.price_sale ?? product.price_sale,
          price_cost: price.price_cost ?? null,
          is_available: price.is_available,
        }));

      const schoolIdsForRpc = product.school_ids ?? null;

      const result = await saveProductScopeAndPrices({
        productId: product.id,
        schoolIds: schoolIdsForRpc,
        prices: customPricesArray,
      });

      const n = result.rows_inserted ?? customPricesArray.length;

      toast({
        title: '✅ Precios actualizados',
        description:
          role === 'admin_general' || role === 'supervisor_red'
            ? `Guardado atómico: ${n} sede(s) con precio personalizado`
            : 'Se actualizó el precio para tu sede correctamente',
      });

      onClose();
    } catch (error: unknown) {
      const scopeError = isPriceScopeRelatedError(error);
      const friendly = getPriceScopeFriendlyToast();
      toast({
        variant: 'destructive',
        title: scopeError ? friendly.title : 'Error',
        description: scopeError ? friendly.description : getGenericSaveErrorDescription(error),
      });
    } finally {
      setSaving(false);
    }
  };

  // Función para obtener diminutivo de la sede
  const getSchoolAcronym = (schoolName: string): string => {
    // Extraer iniciales de palabras significativas
    const words = schoolName
      .split(' ')
      .filter(word => !['de', 'la', 'el', 'y', 'del'].includes(word.toLowerCase()));
    
    if (words.length === 1) {
      return words[0].substring(0, 3).toUpperCase();
    }
    
    return words
      .map(word => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 4);
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
            {/* Banner de alcance del producto */}
            {product.school_ids == null ? (
              <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                <Globe className="h-4 w-4 flex-shrink-0 text-indigo-500" />
                <span>
                  <strong>Producto global</strong> — se muestran todas las sedes.
                  Puedes configurar precios distintos en cualquiera de ellas.
                </span>
              </div>
            ) : product.school_ids.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Lock className="h-4 w-4 flex-shrink-0 text-amber-500" />
                <span>
                  <strong>Sin sedes asignadas.</strong> Asigna sedes en el paso de Disponibilidad antes de configurar precios.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Lock className="h-4 w-4 flex-shrink-0 text-amber-500" />
                <span>
                  <strong>Alcance restringido</strong> — solo se muestran las{' '}
                  <strong>{product.school_ids.length} sede(s)</strong> donde este producto está disponible.
                  Para ampliar el alcance, edita la Disponibilidad del producto.
                </span>
              </div>
            )}

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
                    <TableHead className="w-[20%]">Precio Costo</TableHead>
                    <TableHead className="w-[20%]">Precio Venta</TableHead>
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
                          <div className="flex items-center gap-2">
                            <span>{school.name}</span>
                            <Badge variant="outline" className="text-xs bg-gray-100">
                              {getSchoolAcronym(school.name)}
                            </Badge>
                            {isCustom && (
                              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800">
                                Personalizado
                              </Badge>
                            )}
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
