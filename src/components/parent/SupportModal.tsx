import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MessageCircle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentId: string;
  parentName: string;
  studentId: string | null;
  studentName: string | null;
  supportPhone?: string;
}

export function SupportModal({
  isOpen,
  onClose,
  parentId,
  parentName,
  studentId,
  studentName,
  supportPhone = '51991236870',
}: SupportModalProps) {
  const { toast } = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const waText = useMemo(() => {
    const pName = parentName?.trim() || 'Padre de familia';
    const sName = studentName?.trim() || 'Sin alumno seleccionado';
    const sId = studentId ?? 'N/A';
    const rawText =
      `Hola, necesito soporte del portal de padres.\n` +
      `Padre: ${pName}\n` +
      `Alumno: ${sName}\n` +
      `Student ID: ${sId}`;
    return encodeURIComponent(rawText);
  }, [parentName, studentName, studentId]);

  const openWhatsApp = () => {
    window.open(`https://wa.me/${supportPhone}?text=${waText}`, '_blank');
  };

  const submitTicket = async () => {
    if (!parentId) {
      toast({ variant: 'destructive', title: 'Sesión no válida', description: 'No se pudo identificar al padre autenticado.' });
      return;
    }
    if (!subject.trim()) {
      toast({ variant: 'destructive', title: 'Asunto requerido', description: 'Ingresa un asunto para tu consulta.' });
      return;
    }
    if (!message.trim()) {
      toast({ variant: 'destructive', title: 'Mensaje requerido', description: 'Describe tu consulta para soporte.' });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from('support_tickets')
      .insert({
        parent_id: parentId,
        parent_name: parentName || null,
        student_id: studentId,
        student_name: studentName || null,
        subject: subject.trim(),
        message: message.trim(),
        status: 'open',
      });

    setSubmitting(false);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'No se pudo registrar el ticket',
        description: error.message,
      });
      return;
    }

    toast({
      title: 'Ticket registrado',
      description: 'Tu consulta fue guardada y será atendida por soporte.',
    });
    setSubject('');
    setMessage('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Soporte</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
            <p className="text-xs text-slate-500">Padre</p>
            <p className="text-sm font-semibold text-slate-700">{parentName || 'Padre de familia'}</p>
            <p className="text-xs text-slate-500 mt-2">Alumno activo</p>
            <p className="text-sm font-semibold text-slate-700">{studentName || 'Sin alumno seleccionado'}</p>
            <p className="text-xs text-slate-400">ID: {studentId ?? 'N/A'}</p>
          </div>

          <Button type="button" onClick={openWhatsApp} className="w-full gap-2 bg-green-600 hover:bg-green-700">
            <MessageCircle className="h-4 w-4" />
            Abrir WhatsApp con datos prellenados
          </Button>

          <div className="space-y-3 border-t border-slate-100 pt-3">
            <Label htmlFor="support-subject">Asunto</Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ej: No puedo ver mis pagos"
            />

            <Label htmlFor="support-message">Consulta</Label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe lo que ocurre, fecha y pantalla donde se presenta."
            />

            <Button type="button" onClick={submitTicket} disabled={submitting} className="w-full gap-2">
              <Send className="h-4 w-4" />
              {submitting ? 'Registrando...' : 'Enviar ticket de soporte'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
