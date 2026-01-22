import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, Upload, Download, Save, FileSpreadsheet, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

interface BulkProduct {
  id: string;
  name: string;
  code: string;
  has_code: boolean; // NUEVO: Si tiene código manual o lo genera el sistema
  price_cost: string;
  price_sale: string;
  category: string;
  has_stock: boolean;
  stock_initial: string;
  stock_min: string;
  has_igv: boolean;
  active: boolean;
}

interface BulkProductUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  categories: string[];
  schools: any[];
}

export const BulkProductUpload = ({ isOpen, onClose, onSuccess, categories, schools }: BulkProductUploadProps) => {
  const { toast } = useToast();
  const [products, setProducts] = useState<BulkProduct[]>([
    {
      id: crypto.randomUUID(),
      name: '',
      code: '',
      has_code: false, // Por defecto, el sistema genera el código
      price_cost: '',
      price_sale: '',
      category: 'bebidas',
      has_stock: false, // Por defecto, sin control de stock
      stock_initial: '0',
      stock_min: '0',
      has_igv: true,
      active: true,
    },
  ]);
  const [saving, setSaving] = useState(false);
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);

  const addRow = () => {
    setProducts([
      ...products,
      {
        id: crypto.randomUUID(),
        name: '',
        code: '',
        has_code: false,
        price_cost: '',
        price_sale: '',
        category: 'bebidas',
        has_stock: false,
        stock_initial: '0',
        stock_min: '0',
        has_igv: true,
        active: true,
      },
    ]);
  };

  const deleteRow = (id: string) => {
    if (products.length === 1) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debe haber al menos una fila',
      });
      return;
    }
    setProducts(products.filter(p => p.id !== id));
  };

  const updateProduct = (id: string, field: keyof BulkProduct, value: any) => {
    setProducts(products.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const downloadTemplate = () => {
    const template = [
      {
        Nombre: 'Coca Cola 500ml',
        'Código Manual': 'SI',
        Código: '7501234567890',
        'Precio Costo': '2.50',
        'Precio Venta': '3.50',
        Categoría: 'bebidas',
        'Control Stock': 'SI',
        'Stock Inicial': '100',
        'Stock Mínimo': '10',
        'Incluye IGV': 'SI',
      },
      {
        Nombre: 'Papas Lays',
        'Código Manual': 'NO',
        Código: '',
        'Precio Costo': '1.20',
        'Precio Venta': '2.00',
        Categoría: 'snacks',
        'Control Stock': 'NO',
        'Stock Inicial': '0',
        'Stock Mínimo': '0',
        'Incluye IGV': 'SI',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');

    toast({
      title: '📥 Plantilla descargada',
      description: 'Edita el archivo Excel y súbelo para cargar productos masivamente',
    });
  };

  const uploadFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const parsedProducts: BulkProduct[] = data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: row['Nombre'] || '',
          has_code: row['Código Manual']?.toUpperCase() === 'SI',
          code: row['Código'] || '',
          price_cost: String(row['Precio Costo'] || '0'),
          price_sale: String(row['Precio Venta'] || '0'),
          category: row['Categoría'] || 'otros',
          has_stock: row['Control Stock']?.toUpperCase() === 'SI',
          stock_initial: String(row['Stock Inicial'] || '0'),
          stock_min: String(row['Stock Mínimo'] || '0'),
          has_igv: row['Incluye IGV']?.toUpperCase() === 'SI',
          active: true,
        }));

        setProducts(parsedProducts);
        toast({
          title: '✅ Excel cargado',
          description: `Se cargaron ${parsedProducts.length} productos. Revisa y guarda.`,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'No se pudo leer el archivo Excel',
        });
      }
    };
    reader.readAsBinaryString(file);
  };

  const validateProducts = (): boolean => {
    for (const product of products) {
      if (!product.name.trim()) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Todos los productos deben tener nombre',
        });
        return false;
      }
      if (!product.price_sale || parseFloat(product.price_sale) <= 0) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Todos los productos deben tener precio de venta válido',
        });
        return false;
      }
    }
    return true;
  };

  const saveAll = async () => {
    if (!validateProducts()) return;

    setSaving(true);
    try {
      const selectedSchools = applyToAllSchools ? schools.map(s => s.id) : [];

      const productsToInsert = products.map(p => ({
        name: p.name,
        code: p.has_code && p.code ? p.code : `PRD${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
        price: parseFloat(p.price_sale),
        price_cost: parseFloat(p.price_cost) || 0,
        price_sale: parseFloat(p.price_sale),
        category: p.category,
        has_stock: p.has_stock,
        stock_initial: p.has_stock ? parseInt(p.stock_initial) : null,
        stock_min: p.has_stock ? parseInt(p.stock_min) : null,
        has_igv: p.has_igv,
        active: p.active,
        school_ids: selectedSchools,
      }));

      const { error } = await supabase.from('products').insert(productsToInsert);

      if (error) throw error;

      toast({
        title: '✅ Productos guardados',
        description: `Se crearon ${products.length} productos exitosamente`,
      });

      onSuccess();
      onClose();
      
      // Resetear
      setProducts([{
        id: crypto.randomUUID(),
        name: '',
        code: '',
        price_cost: '',
        price_sale: '',
        category: 'bebidas',
        has_stock: true,
        stock_initial: '0',
        stock_min: '0',
        has_igv: true,
        active: true,
      }]);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron guardar los productos: ' + error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileSpreadsheet className="h-6 w-6 text-green-600" />
            Carga Masiva de Productos (Modo Excel)
          </DialogTitle>
          <DialogDescription>
            Agrega múltiples productos a la vez. Puedes escribir directamente en la tabla o importar desde Excel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Descargar Plantilla Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById('excel-upload')?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Importar desde Excel
          </Button>
          <input
            id="excel-upload"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={uploadFromExcel}
          />
          <Button variant="default" size="sm" onClick={addRow} className="ml-auto">
            <Plus className="h-4 w-4 mr-2" />
            Agregar Fila
          </Button>
        </div>

        <div className="flex-1 overflow-auto border rounded-lg">
          <Table>
            <TableHeader className="sticky top-0 bg-muted z-10">
              <TableRow>
                <TableHead className="w-[30px]">#</TableHead>
                <TableHead className="min-w-[200px]">Nombre *</TableHead>
                <TableHead className="min-w-[100px]">Código?</TableHead>
                <TableHead className="min-w-[120px]">Código</TableHead>
                <TableHead className="min-w-[100px]">P. Costo</TableHead>
                <TableHead className="min-w-[100px]">P. Venta *</TableHead>
                <TableHead className="min-w-[120px]">Categoría</TableHead>
                <TableHead className="min-w-[100px]">Stock?</TableHead>
                <TableHead className="min-w-[100px]">Stock Ini.</TableHead>
                <TableHead className="min-w-[100px]">Stock Mín.</TableHead>
                <TableHead className="w-[60px]">IGV</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product, index) => (
                <TableRow key={product.id}>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={product.name}
                      onChange={(e) => updateProduct(product.id, 'name', e.target.value)}
                      placeholder="Nombre del producto"
                      className="h-9"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        checked={product.has_code}
                        onChange={(e) => updateProduct(product.id, 'has_code', e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-muted-foreground">
                        {product.has_code ? 'Manual' : 'Auto'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={product.code}
                      onChange={(e) => updateProduct(product.id, 'code', e.target.value)}
                      placeholder={product.has_code ? "Código de barras" : "Auto (PRD...)"}
                      className="h-9"
                      disabled={!product.has_code}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={product.price_cost}
                      onChange={(e) => updateProduct(product.id, 'price_cost', e.target.value)}
                      placeholder="0.00"
                      className="h-9"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={product.price_sale}
                      onChange={(e) => updateProduct(product.id, 'price_sale', e.target.value)}
                      placeholder="0.00"
                      className="h-9 border-primary"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={product.category}
                      onValueChange={(v) => updateProduct(product.id, 'category', v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        checked={product.has_stock}
                        onChange={(e) => updateProduct(product.id, 'has_stock', e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-muted-foreground">
                        {product.has_stock ? 'Sí' : 'No'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={product.stock_initial}
                      onChange={(e) => updateProduct(product.id, 'stock_initial', e.target.value)}
                      placeholder="0"
                      className="h-9"
                      disabled={!product.has_stock}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={product.stock_min}
                      onChange={(e) => updateProduct(product.id, 'stock_min', e.target.value)}
                      placeholder="0"
                      className="h-9"
                      disabled={!product.has_stock}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      checked={product.has_igv}
                      onChange={(e) => updateProduct(product.id, 'has_igv', e.target.checked)}
                      className="h-4 w-4"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRow(product.id)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex gap-3 pt-4 border-t">
          <div className="flex-1 flex items-center gap-2 text-sm text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4" />
            {products.length} producto(s) en la lista
          </div>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={saveAll} disabled={saving} size="lg" className="px-8">
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="h-5 w-5 mr-2" />
                Guardar Todos ({products.length})
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
