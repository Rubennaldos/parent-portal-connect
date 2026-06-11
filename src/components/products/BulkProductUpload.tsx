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
  description: string; // NUEVO: Descripción del producto
  code: string;
  has_code: boolean; // Si tiene código manual o lo genera el sistema
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
      description: '',
      code: '',
      has_code: false,
      price_cost: '',
      price_sale: '',
      category: '', // VACÍO: el usuario elige su categoría
      has_stock: false,
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
        description: '',
        code: '',
        has_code: false,
        price_cost: '',
        price_sale: '',
        category: '', // VACÍO: el usuario elige su categoría
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
        Descripción: 'Bebida gaseosa sabor cola en presentación de 500ml. Refresca tu día con el sabor clásico.',
        'Código Manual': 'SI',
        Código: '7501234567890',
        'Precio Costo': '2.50',
        'Precio Venta': '3.50',
        Categoría: 'Bebidas',
        'Control Stock': 'SI',
        'Stock Inicial': '100',
        'Stock Mínimo': '10',
        'Incluye IGV': 'SI',
      },
      {
        Nombre: 'Papas Lays Clásicas',
        Descripción: 'Snack crujiente de papas fritas con sal. Perfecto para compartir o disfrutar solo.',
        'Código Manual': 'NO',
        Código: '',
        'Precio Costo': '1.20',
        'Precio Venta': '2.00',
        Categoría: 'Snacks Salados',
        'Control Stock': 'NO',
        'Stock Inicial': '0',
        'Stock Mínimo': '0',
        'Incluye IGV': 'SI',
      },
      {
        Nombre: 'Galletas Oreo',
        Descripción: 'Galletas de chocolate con relleno de crema. El clásico favorito de todos.',
        'Código Manual': 'SI',
        Código: '7622300489120',
        'Precio Costo': '1.80',
        'Precio Venta': '3.00',
        Categoría: 'Snacks Dulces',
        'Control Stock': 'SI',
        'Stock Inicial': '50',
        'Stock Mínimo': '5',
        'Incluye IGV': 'SI',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    
    // Ajustar anchos de columna para que la descripción se vea completa
    ws['!cols'] = [
      { wch: 25 },  // Nombre
      { wch: 60 },  // Descripción (más ancha)
      { wch: 15 },  // Código Manual
      { wch: 18 },  // Código
      { wch: 12 },  // Precio Costo
      { wch: 12 },  // Precio Venta
      { wch: 15 },  // Categoría
      { wch: 13 },  // Control Stock
      { wch: 13 },  // Stock Inicial
      { wch: 13 },  // Stock Mínimo
      { wch: 12 },  // Incluye IGV
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');

    toast({
      title: '📥 Plantilla descargada',
      description: 'Las categorías se crearán automáticamente desde tu Excel',
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
          description: row['Descripción'] || row['Descripcion'] || '', // NUEVO: Acepta con o sin tilde
          has_code: row['Código Manual']?.toUpperCase() === 'SI',
          code: row['Código'] || row['Codigo'] || '',
          price_cost: String(row['Precio Costo'] || '0'),
          price_sale: String(row['Precio Venta'] || '0'),
          category: row['Categoría'] || row['Categoria'] || 'otros',
          has_stock: row['Control Stock']?.toUpperCase() === 'SI',
          stock_initial: String(row['Stock Inicial'] || '0'),
          stock_min: String(row['Stock Mínimo'] || row['Stock Minimo'] || '0'),
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
    console.log('🔍 Validando productos:', products);
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const rowNum = i + 1;

      console.log(`📋 Fila ${rowNum}:`, {
        name: product.name,
        price_sale: product.price_sale,
        price_sale_type: typeof product.price_sale,
        category: product.category,
      });

      // Validar nombre
      if (!product.name || !product.name.trim()) {
        toast({
          variant: 'destructive',
          title: `Error en fila ${rowNum}`,
          description: 'El producto debe tener un nombre',
        });
        return false;
      }

      // Validar precio de venta
      const priceValue = parseFloat(product.price_sale || '0');
      console.log(`💰 Precio parseado en fila ${rowNum}:`, priceValue);
      
      if (isNaN(priceValue) || priceValue <= 0) {
        toast({
          variant: 'destructive',
          title: `Error en fila ${rowNum}: ${product.name}`,
          description: `Precio de venta inválido: "${product.price_sale}". Debe ser mayor a 0`,
        });
        return false;
      }

      // Validar categoría
      if (!product.category || !product.category.trim()) {
        toast({
          variant: 'destructive',
          title: `Error en fila ${rowNum}: ${product.name}`,
          description: 'El producto debe tener una categoría',
        });
        return false;
      }
    }
    
    console.log('✅ Validación exitosa');
    return true;
  };

  const saveAll = async () => {
    if (!validateProducts()) return;

    setSaving(true);
    try {
      const selectedSchools = applyToAllSchools ? schools.map(s => s.id) : [];

      const productsToInsert = products.map(p => ({
        name: p.name,
        description: p.description || null,
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
        stock_control_enabled: p.has_stock,
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
        description: '',
        code: '',
        has_code: false,
        price_cost: '',
        price_sale: '',
        category: '', // VACÍO
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
                <TableHead className="min-w-[180px]">Nombre *</TableHead>
                <TableHead className="min-w-[250px]">Descripción</TableHead>
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
                  <TableCell>
                    <textarea
                      value={product.description}
                      onChange={(e) => updateProduct(product.id, 'description', e.target.value)}
                      placeholder="Descripción del producto (beneficios, características, etc.)"
                      className="w-full h-20 px-3 py-2 text-sm border rounded-md resize-none"
                      rows={3}
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
                    <Input
                      value={product.category}
                      onChange={(e) => updateProduct(product.id, 'category', e.target.value)}
                      placeholder="Ej: Bebidas, Snacks Salados, etc."
                      className="h-9"
                      list={`categories-${product.id}`}
                    />
                    <datalist id={`categories-${product.id}`}>
                      {categories.map(cat => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
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
