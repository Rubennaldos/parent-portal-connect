import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Building2, Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, Loader2, CheckCircle2
} from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
}

const emptyForm = () => ({
  name: '',
  ruc: '',
  address: '',
  phone: '',
  email: '',
});

export const SuppliersTab = () => {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [rucSearching, setRucSearching] = useState(false);

  useEffect(() => { loadSuppliers(); }, []);

  const loadSuppliers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name');
    if (!error) setSuppliers(data || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({ name: s.name, ruc: s.ruc || '', address: s.address || '', phone: s.phone || '', email: s.email || '' });
    setShowModal(true);
  };

  const handleRucSearch = async () => {
    const ruc = form.ruc.replace(/\D/g, '').trim();
    if (ruc.length !== 11) {
      toast({ variant: 'destructive', title: 'RUC inválido', description: 'El RUC debe tener 11 dígitos.' });
      return;
    }
    setRucSearching(true);
    try {
      // Usamos el anon key del proyecto para autenticar el edge function.
      // supabase.functions.invoke a veces pierde el token de sesión en dev,
      // pero el anon key siempre es válido para este tipo de consulta pública.
      const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').toString().trim();
      const { data, error } = await supabase.functions.invoke('consult-document', {
        body: { tipo: 'ruc', numero: ruc },
        headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
      });
      if (error || !data?.success) {
        toast({ variant: 'destructive', title: 'No encontrado', description: data?.error || 'RUC no encontrado en SUNAT.' });
        return;
      }
      setForm(prev => ({
        ...prev,
        ruc,
        name: data.razon_social || prev.name,
        address: data.direccion || prev.address,
      }));
      toast({ title: '✅ Datos cargados', description: `Razón social: ${data.razon_social}` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setRucSearching(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        ruc: form.ruc.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (editingId) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId);
        if (error) throw error;
        toast({ title: '✅ Proveedor actualizado' });
      } else {
        const { error } = await supabase.from('suppliers').insert(payload);
        if (error) throw error;
        toast({ title: '✅ Proveedor creado' });
      }
      setShowModal(false);
      loadSuppliers();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar proveedor "${name}"?`)) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } else {
      toast({ title: '✅ Proveedor eliminado' });
      loadSuppliers();
    }
  };

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.ruc || '').includes(search)
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-6 w-6 text-[#8B4513]" />
                Proveedores
              </CardTitle>
              <CardDescription>
                Empresas y personas de las que compras insumos. Búsqueda automática por RUC (SUNAT).
              </CardDescription>
            </div>
            <Button className="bg-[#8B4513] hover:bg-[#6F370F]" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Proveedor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o RUC..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {search ? 'Sin resultados para tu búsqueda' : 'No hay proveedores registrados. ¡Crea el primero!'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(s => (
                <Card key={s.id} className="border-l-4 border-l-amber-500">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base leading-tight">{s.name}</CardTitle>
                      <div className="flex gap-1 ml-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(s.id, s.name)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {s.ruc && (
                      <Badge variant="outline" className="w-fit text-xs">
                        RUC {s.ruc}
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-slate-500">
                    {s.address && (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{s.address}</span>
                      </div>
                    )}
                    {s.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{s.phone}</span>
                      </div>
                    )}
                    {s.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.email}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal crear/editar proveedor */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#8B4513]" />
              {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* RUC con búsqueda automática */}
            <div className="space-y-2">
              <Label>RUC (opcional)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Ej: 20601234567"
                  value={form.ruc}
                  onChange={e => setForm(f => ({ ...f, ruc: e.target.value }))}
                  maxLength={11}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRucSearch}
                  disabled={rucSearching || form.ruc.replace(/\D/g, '').length !== 11}
                  className="shrink-0"
                >
                  {rucSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {rucSearching ? '' : 'Buscar'}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Ingresa el RUC de 11 dígitos y presiona Buscar para autocompletar con datos de SUNAT.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Razón Social / Nombre <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Nombre del proveedor"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input
                placeholder="Dirección fiscal"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input
                  placeholder="999 000 000"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="contacto@empresa.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-[#8B4513] hover:bg-[#6F370F]"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
