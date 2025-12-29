import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  ShoppingCart, 
  LogOut, 
  Search,
  Plus,
  Minus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  User
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface Student {
  id: string;
  name: string;
  photo_url: string | null;
  balance: number;
  grade: string;
  section: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image_url: string | null;
  stock: number;
  is_available: boolean;
}

interface CartItem {
  product: Product;
  quantity: number;
}

const POS = () => {
  const { signOut, user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  // Estados
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [showStudentResults, setShowStudentResults] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('todos');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Cargar productos al inicio
  useEffect(() => {
    fetchProducts();
  }, []);

  // Filtrar productos por búsqueda y categoría
  useEffect(() => {
    let filtered = products;

    // Filtrar por categoría
    if (selectedCategory !== 'todos') {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }

    // Filtrar por búsqueda
    if (productSearch.trim()) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      );
    }

    setFilteredProducts(filtered);
  }, [productSearch, selectedCategory, products]);

  // Buscar estudiantes cuando se escribe
  useEffect(() => {
    if (studentSearch.trim().length >= 2) {
      searchStudents(studentSearch);
      setShowStudentResults(true);
    } else {
      setStudents([]);
      setShowStudentResults(false);
    }
  }, [studentSearch]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_available', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setProducts(data || []);
      setFilteredProducts(data || []);
    } catch (error: any) {
      console.error('Error fetching products:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los productos',
      });
    }
  };

  const searchStudents = async (query: string) => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('is_active', true)
        .ilike('name', `%${query}%`)
        .limit(5);

      if (error) throw error;
      setStudents(data || []);
    } catch (error: any) {
      console.error('Error searching students:', error);
    }
  };

  const selectStudent = (student: Student) => {
    setSelectedStudent(student);
    setStudentSearch(student.name);
    setShowStudentResults(false);
    setCart([]); // Limpiar carrito al cambiar de estudiante
  };

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product.id === product.id);
    
    if (existing) {
      setCart(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }

    // Feedback visual
    toast({
      title: '✅ Agregado',
      description: `${product.name} agregado al carrito`,
      duration: 1500,
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.product.id === productId) {
        const newQuantity = item.quantity + delta;
        return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const getTotal = () => {
    return cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  };

  const canCheckout = () => {
    if (!selectedStudent) return false;
    if (cart.length === 0) return false;
    const total = getTotal();
    return selectedStudent.balance >= total;
  };

  const handleCheckout = async () => {
    if (!selectedStudent) return;
    if (!canCheckout()) return;

    setIsProcessing(true);

    try {
      const total = getTotal();
      const newBalance = selectedStudent.balance - total;

      // 1. Crear transacción
      const { data: transaction, error: transError } = await supabase
        .from('transactions')
        .insert({
          student_id: selectedStudent.id,
          type: 'purchase',
          amount: -total,
          description: `Compra en POS - ${cart.length} items`,
          balance_after: newBalance,
          created_by: user?.id,
        })
        .select()
        .single();

      if (transError) throw transError;

      // 2. Crear items de la transacción
      const items = cart.map(item => ({
        transaction_id: transaction.id,
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        subtotal: item.product.price * item.quantity,
      }));

      const { error: itemsError } = await supabase
        .from('transaction_items')
        .insert(items);

      if (itemsError) throw itemsError;

      // 3. Actualizar saldo del estudiante
      const { error: updateError } = await supabase
        .from('students')
        .update({ balance: newBalance })
        .eq('id', selectedStudent.id);

      if (updateError) throw updateError;

      // 4. Éxito
      toast({
        title: '✅ Venta Realizada',
        description: `Nuevo saldo: S/ ${newBalance.toFixed(2)}`,
        duration: 3000,
      });

      // 5. Limpiar y actualizar
      setSelectedStudent({ ...selectedStudent, balance: newBalance });
      setCart([]);
      setProductSearch('');

    } catch (error: any) {
      console.error('Error processing checkout:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo completar la venta: ' + error.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  const total = getTotal();
  const insufficientBalance = selectedStudent && (selectedStudent.balance < total);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="bg-green-600 text-white px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <span className="font-semibold">Punto de Venta</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white hover:bg-green-700">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content - 2 Columnas */}
      <div className="container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* COLUMNA IZQUIERDA - Catálogo */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Buscador de Estudiantes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-green-600" />
                  Buscar Estudiante
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Escribe el nombre del estudiante..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    className="pl-10 text-lg h-12"
                  />
                </div>

                {/* Resultados de búsqueda */}
                {showStudentResults && students.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {students.map((student) => (
                      <button
                        key={student.id}
                        onClick={() => selectStudent(student)}
                        className="w-full p-3 hover:bg-green-50 text-left flex items-center gap-3"
                      >
                        <img
                          src={student.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.name}`}
                          alt={student.name}
                          className="w-10 h-10 rounded-full"
                        />
                        <div className="flex-1">
                          <p className="font-medium">{student.name}</p>
                          <p className="text-xs text-gray-500">{student.grade} - {student.section}</p>
                        </div>
                        <Badge variant="secondary">S/ {student.balance.toFixed(2)}</Badge>
                      </button>
                    ))}
                  </div>
                )}

                {/* Estudiante seleccionado */}
                {selectedStudent && !showStudentResults && (
                  <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 flex items-center gap-4">
                    <img
                      src={selectedStudent.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedStudent.name}`}
                      alt={selectedStudent.name}
                      className="w-16 h-16 rounded-full border-2 border-green-600"
                    />
                    <div className="flex-1">
                      <h3 className="font-bold text-lg">{selectedStudent.name}</h3>
                      <p className="text-sm text-gray-600">{selectedStudent.grade} - {selectedStudent.section}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600">Saldo</p>
                      <p className="text-2xl font-bold text-green-600">
                        S/ {selectedStudent.balance.toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Buscador de Productos + Categorías */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar productos..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                
                {/* Categorías */}
                <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="mt-3">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="todos">Todos</TabsTrigger>
                    <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
                    <TabsTrigger value="snacks">Snacks</TabsTrigger>
                    <TabsTrigger value="menu">Menú</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              
              <CardContent>
                {/* Grid de Productos */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="border-2 border-gray-200 rounded-lg p-3 hover:border-green-500 hover:shadow-lg transition-all text-left"
                      disabled={!selectedStudent}
                    >
                      <img
                        src={product.image_url || 'https://via.placeholder.com/150'}
                        alt={product.name}
                        className="w-full h-24 object-cover rounded mb-2"
                      />
                      <h4 className="font-semibold text-sm line-clamp-2 mb-1">{product.name}</h4>
                      <p className="text-lg font-bold text-green-600">S/ {product.price.toFixed(2)}</p>
                      {product.stock < 10 && (
                        <Badge variant="destructive" className="text-xs mt-1">Stock: {product.stock}</Badge>
                      )}
                    </button>
                  ))}
                </div>

                {filteredProducts.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Search className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No se encontraron productos</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* COLUMNA DERECHA - Carrito */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardHeader className="bg-green-600 text-white rounded-t-lg">
                <CardTitle className="flex items-center justify-between">
                  <span>Carrito</span>
                  <Badge variant="secondary">{cart.length} items</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {/* Items del Carrito */}
                <div className="max-h-[300px] overflow-y-auto divide-y">
                  {cart.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>Carrito vacío</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div key={item.product.id} className="p-3 flex items-center gap-2">
                        <img
                          src={item.product.image_url || 'https://via.placeholder.com/50'}
                          alt={item.product.name}
                          className="w-12 h-12 object-cover rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.product.name}</p>
                          <p className="text-xs text-gray-600">S/ {item.product.price.toFixed(2)} c/u</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="h-8 w-8 p-0"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-bold">{item.quantity}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="h-8 w-8 p-0"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => removeFromCart(item.product.id)}
                            className="h-8 w-8 p-0 ml-1"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Total y Checkout */}
                {cart.length > 0 && (
                  <div className="p-4 border-t bg-gray-50 space-y-3">
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span>TOTAL:</span>
                      <span className="text-2xl text-green-600">S/ {total.toFixed(2)}</span>
                    </div>

                    {/* Validación de Saldo */}
                    {selectedStudent && (
                      <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                        insufficientBalance 
                          ? 'bg-red-50 text-red-800 border border-red-200' 
                          : 'bg-green-50 text-green-800 border border-green-200'
                      }`}>
                        {insufficientBalance ? (
                          <>
                            <AlertCircle className="h-4 w-4" />
                            <div>
                              <p className="font-semibold">Saldo Insuficiente</p>
                              <p className="text-xs">Falta: S/ {(total - selectedStudent.balance).toFixed(2)}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <div>
                              <p className="font-semibold">Saldo Suficiente</p>
                              <p className="text-xs">Saldo después: S/ {(selectedStudent.balance - total).toFixed(2)}</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Botón Cobrar */}
                    <Button
                      onClick={handleCheckout}
                      disabled={!canCheckout() || isProcessing}
                      className="w-full h-14 text-lg font-bold"
                    >
                      {isProcessing ? (
                        'Procesando...'
                      ) : (
                        <>
                          <CheckCircle2 className="h-5 w-5 mr-2" />
                          COBRAR
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default POS;
