import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Building2, MessageCircle, MonitorSmartphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { SUPPORT_TECH_WHATSAPP, type ParentSupportChannel } from '@/config/support.config';
import {
  buildParentSupportWhatsAppBody,
  buildParentSupportWhatsAppUrl,
  normalizeWhatsAppPhone,
  SUPPORT_CHANNEL_COPY,
} from '@/lib/supportWhatsApp';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentName: string;
  studentName: string | null;
  schoolName?: string | null;
  schoolAdminName?: string | null;
  schoolAdminWhatsApp?: string | null;
}

export function SupportModal({
  isOpen,
  onClose,
  parentName,
  studentName,
  schoolName,
  schoolAdminName,
  schoolAdminWhatsApp,
}: SupportModalProps) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<ParentSupportChannel>('school_admin');
  const [subject, setSubject] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [techContactName, setTechContactName] = useState('Soporte Técnico');
  const [techContactPhone, setTechContactPhone] = useState(normalizeWhatsAppPhone(SUPPORT_TECH_WHATSAPP));

  const schoolAdminPhone = useMemo(
    () => normalizeWhatsAppPhone(schoolAdminWhatsApp),
    [schoolAdminWhatsApp]
  );

  const destinationPhone = useMemo(() => {
    if (channel === 'school_admin') return schoolAdminPhone;
    return techContactPhone;
  }, [channel, schoolAdminPhone, techContactPhone]);

  const destinationName = useMemo(() => {
    if (channel === 'school_admin') return schoolAdminName?.trim() || 'Administración de sede';
    return techContactName.trim() || 'Soporte Técnico';
  }, [channel, schoolAdminName, techContactName]);

  useEffect(() => {
    if (!isOpen) return;

    const loadTechnicalContact = async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'support_technical_contact')
        .maybeSingle<{ value: { admin_name?: string; technical_whatsapp?: string } }>();

      if (error) {
        setTechContactName('Soporte Técnico');
        setTechContactPhone(normalizeWhatsAppPhone(SUPPORT_TECH_WHATSAPP));
        return;
      }

      const payload = data?.value ?? {};
      setTechContactName((payload.admin_name ?? 'Soporte Técnico').toString().trim() || 'Soporte Técnico');
      setTechContactPhone(normalizeWhatsAppPhone((payload.technical_whatsapp ?? SUPPORT_TECH_WHATSAPP).toString()));
    };

    void loadTechnicalContact();
  }, [isOpen]);

  const openWhatsApp = () => {
    if (!subject.trim()) {
      toast({
        variant: 'destructive',
        title: 'Asunto requerido',
        description: 'Escribe el asunto antes de continuar.',
      });
      return;
    }
    if (!inquiry.trim()) {
      toast({
        variant: 'destructive',
        title: 'Consulta requerida',
        description: 'Describe tu consulta para poder ayudarte.',
      });
      return;
    }
    if (!destinationPhone) {
      toast({
        variant: 'destructive',
        title: 'Canal sin número configurado',
        description:
          channel === 'school_admin'
            ? 'La sede aún no tiene WhatsApp administrativo configurado. Usa Soporte Técnico.'
            : 'No hay un número de soporte técnico configurado.',
      });
      return;
    }

    const body = buildParentSupportWhatsAppBody({
      schoolName: schoolName ?? 'Colegio no indicado',
      parentName,
      studentName: studentName ?? 'Sin alumno seleccionado',
      subject,
      inquiry,
    });
    const url = buildParentSupportWhatsAppUrl(destinationPhone, body);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Soporte</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Colegio</p>
            <p className="text-sm font-semibold text-slate-700">{schoolName || 'Colegio no indicado'}</p>
            <p className="text-xs text-slate-500">Padre</p>
            <p className="text-sm font-semibold text-slate-700">{parentName || 'Padre de familia'}</p>
            <p className="text-xs text-slate-500 mt-2">Alumno activo</p>
            <p className="text-sm font-semibold text-slate-700">{studentName || 'Sin alumno seleccionado'}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">Selecciona el tipo de soporte</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setChannel('school_admin')}
                className={`rounded-xl border p-3 text-left transition-all ${
                  channel === 'school_admin'
                    ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-emerald-300'
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-emerald-700">
                  <Building2 className="h-4 w-4" />
                  <span className="text-sm font-semibold">{SUPPORT_CHANNEL_COPY.school_admin.title}</span>
                </div>
                <p className="text-xs text-slate-600">{SUPPORT_CHANNEL_COPY.school_admin.description}</p>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                  {SUPPORT_CHANNEL_COPY.school_admin.badge}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setChannel('technical')}
                className={`rounded-xl border p-3 text-left transition-all ${
                  channel === 'technical'
                    ? 'border-violet-500 bg-violet-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-violet-300'
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-violet-700">
                  <MonitorSmartphone className="h-4 w-4" />
                  <span className="text-sm font-semibold">{SUPPORT_CHANNEL_COPY.technical.title}</span>
                </div>
                <p className="text-xs text-slate-600">{SUPPORT_CHANNEL_COPY.technical.description}</p>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-violet-700">
                  {SUPPORT_CHANNEL_COPY.technical.badge}
                </p>
              </button>
            </div>
          </div>

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
              value={inquiry}
              onChange={(e) => setInquiry(e.target.value)}
              rows={4}
              placeholder="Describe lo que ocurre, fecha y pantalla donde se presenta."
            />

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Destino seleccionado:{' '}
              <span className="font-semibold text-slate-800">
                {destinationPhone ? `${destinationName}: ${destinationPhone}` : `${destinationName}: no configurado`}
              </span>
            </p>

            <Button
              type="button"
              onClick={openWhatsApp}
              className="w-full gap-2 bg-green-600 text-white hover:bg-green-700"
            >
              <MessageCircle className="h-4 w-4" />
              Contactar con Soporte WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
