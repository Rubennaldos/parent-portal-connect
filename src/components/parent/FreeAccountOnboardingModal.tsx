import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, ShieldCheck, Info } from 'lucide-react';
import { useState } from 'react';

interface FreeAccountOnboardingModalProps {
  open: boolean;
  onAccept: () => void;
  parentName: string;
}

export function FreeAccountOnboardingModal({ 
  open, 
  onAccept,
  parentName
}: FreeAccountOnboardingModalProps) {
  const [understood, setUnderstood] = useState(false);

  const handleAccept = () => {
    if (understood) {
      onAccept();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black text-slate-800">
                ¡Bienvenido, {parentName}!
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-1">
                Autorización de Cuenta Libre
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Explicación */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <h3 className="font-black text-emerald-900 mb-3 flex items-center gap-2">
              <Check className="h-5 w-5" />
              ¿Qué es una Cuenta Libre?
            </h3>
            <p className="text-sm text-emerald-800 leading-relaxed">
              Todos tus hijos están en modo <span className="font-bold">Cuenta Libre</span> por defecto. 
              Esto significa que pueden consumir en el kiosco sin necesidad de recargar saldo previamente, 
              y tú pagarás al final del mes por sus consumos.
            </p>
          </div>

          {/* Ventajas */}
          <div>
            <h4 className="font-bold text-slate-800 mb-3 text-sm">✨ Ventajas:</h4>
            <ul className="space-y-2">
              <li className="flex items-start gap-3 text-sm text-slate-600">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <span><strong>Sin recargas anticipadas:</strong> No necesitas estar transfiriendo dinero constantemente</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-600">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <span><strong>Acceso inmediato:</strong> Tus hijos pueden comprar lo que necesiten al instante</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-600">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <span><strong>Control total:</strong> Puedes establecer límites diarios, semanales o mensuales</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-slate-600">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <span><strong>Historial completo:</strong> Ve todos los consumos con un retraso de 2 días (tiempo de registro manual del kiosco)</span>
              </li>
            </ul>
          </div>

          {/* Información importante */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
            <Info className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-amber-900 text-sm mb-1">📝 Importante:</h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                Puedes cambiar entre <strong>Cuenta Libre</strong> y <strong>Cuenta Prepago</strong> 
                cuando lo desees desde la configuración de cada hijo. Los límites de gasto los puedes ajustar en cualquier momento.
              </p>
            </div>
          </div>

          {/* Checkbox de entendimiento */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="w-5 h-5 rounded border-2 border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">
              Entiendo y acepto que mis hijos están en Cuenta Libre
            </span>
          </label>

          {/* Botón de aceptar */}
          <Button
            onClick={handleAccept}
            disabled={!understood}
            className="w-full h-14 text-base font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ¡COMENZAR A USAR EL PORTAL!
          </Button>

          <p className="text-xs text-center text-slate-400">
            Esta autorización es solo informativa. Puedes modificar la configuración en cualquier momento.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
