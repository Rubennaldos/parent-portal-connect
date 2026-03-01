import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, ShieldCheck, Info, UtensilsCrossed, ShoppingBag, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface FreeAccountOnboardingModalProps {
  open: boolean;
  onAccept: (kioskDisabled: boolean) => void;
  parentName: string;
}

export function FreeAccountOnboardingModal({ 
  open, 
  onAccept,
  parentName
}: FreeAccountOnboardingModalProps) {
  const [understood, setUnderstood] = useState(false);
  // 'kiosk' = solo almuerzo (sin cuenta kiosco), 'full' = cuenta libre completa
  const [accountChoice, setAccountChoice] = useState<'full' | 'kiosk'>('full');
  const [confirmDisable, setConfirmDisable] = useState(false);

  const handleAccept = () => {
    if (!understood) return;
    if (accountChoice === 'kiosk' && !confirmDisable) {
      setConfirmDisable(true);
      return;
    }
    onAccept(accountChoice === 'kiosk');
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
        <DialogHeader className="pb-4">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-[#8B7355]/10 to-[#6B5744]/10 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="h-9 w-9 text-[#8B7355]" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-light text-stone-800 tracking-wide">
                ¡Bienvenido, {parentName}!
              </DialogTitle>
              <DialogDescription className="text-sm text-stone-500 mt-2 font-normal">
                Configuración de cuenta del kiosco
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Explicación */}
          <div className="bg-stone-50/50 border border-stone-200/50 rounded-xl p-5">
            <h3 className="font-medium text-stone-800 mb-2 flex items-center gap-2 text-sm">
              <Check className="h-5 w-5 text-[#8B7355]" />
              ¿Cómo quieres configurar la cuenta de tus hijos?
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed font-normal">
              Todos los alumnos nacen con <strong className="text-stone-800">Cuenta Libre</strong> en el kiosco.
              Puedes mantenerla o desactivarla si prefieres que solo usen el servicio de almuerzos.
            </p>
          </div>

          {/* Opciones de cuenta */}
          <div className="space-y-3">
            <h4 className="font-medium text-stone-700 text-xs uppercase tracking-wider">Elige una opción</h4>

            {/* Opción 1: Cuenta Libre completa */}
            <button
              type="button"
              onClick={() => setAccountChoice('full')}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                accountChoice === 'full'
                  ? 'border-[#8B7355] bg-[#8B7355]/5'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  accountChoice === 'full' ? 'bg-[#8B7355]/10' : 'bg-stone-100'
                }`}>
                  <ShoppingBag className={`h-5 w-5 ${accountChoice === 'full' ? 'text-[#8B7355]' : 'text-stone-400'}`} />
                </div>
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${accountChoice === 'full' ? 'text-[#8B7355]' : 'text-stone-700'}`}>
                    ✅ Cuenta Libre — Acceso completo al kiosco
                  </p>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                    Mis hijos pueden comprar en el kiosco y pedir almuerzos. Pago al final del período.
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" /> Compras en el kiosco
                    </li>
                    <li className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" /> Pedidos de almuerzo
                    </li>
                    <li className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" /> Topes de gasto configurables
                    </li>
                  </ul>
                </div>
                {accountChoice === 'full' && (
                  <div className="w-5 h-5 rounded-full bg-[#8B7355] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                )}
              </div>
            </button>

            {/* Opción 2: Solo almuerzo */}
            <button
              type="button"
              onClick={() => { setAccountChoice('kiosk'); setConfirmDisable(false); }}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                accountChoice === 'kiosk'
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  accountChoice === 'kiosk' ? 'bg-orange-100' : 'bg-stone-100'
                }`}>
                  <UtensilsCrossed className={`h-5 w-5 ${accountChoice === 'kiosk' ? 'text-orange-500' : 'text-stone-400'}`} />
                </div>
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${accountChoice === 'kiosk' ? 'text-orange-700' : 'text-stone-700'}`}>
                    🍽️ Solo Almuerzos — Sin cuenta en el kiosco
                  </p>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                    Mis hijos <strong>no tienen cuenta</strong> en el kiosco. Solo podrán pedir almuerzo desde el calendario. 
                    Cualquier otra compra será en efectivo.
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li className="text-xs text-stone-500 flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" /> Pedidos de almuerzo habilitados
                    </li>
                    <li className="text-xs text-red-400 flex items-center gap-1.5">
                      <span className="text-red-400 font-bold flex-shrink-0">✕</span> Sin cuenta en el kiosco
                    </li>
                    <li className="text-xs text-stone-400 flex items-center gap-1.5">
                      <Info className="h-3 w-3 text-stone-400 flex-shrink-0" /> Compras solo en efectivo
                    </li>
                  </ul>
                </div>
                {accountChoice === 'kiosk' && (
                  <div className="w-5 h-5 rounded-full bg-orange-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                )}
              </div>
            </button>
          </div>

          {/* Advertencia si se elige solo almuerzo */}
          {accountChoice === 'kiosk' && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-amber-900 text-sm mb-1">⚠️ Importante — Sin cuenta en el kiosco</h4>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Si desactivas la cuenta del kiosco, <strong>tus hijos solo podrán pagar en efectivo</strong> para cualquier compra 
                  en el kiosco. Podrás reactivarla cuando quieras desde la configuración de cada hijo.
                </p>
              </div>
            </div>
          )}

          {/* Confirmación de desactivar kiosco */}
          {accountChoice === 'kiosk' && confirmDisable && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-800 mb-1">¿Confirmas que quieres desactivar la cuenta del kiosco?</p>
              <p className="text-xs text-red-600">
                Tus hijos aparecerán en el sistema con cuenta cerrada. Podrás reactivarla luego.
              </p>
            </div>
          )}

          {/* Información general */}
          <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl p-4 flex gap-3">
            <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Puedes cambiar esta configuración en cualquier momento desde la sección 
              <strong className="font-medium"> Configuración de Topes</strong> de cada hijo.
            </p>
          </div>

          {/* Checkbox de entendimiento */}
          <label className="flex items-start gap-3 cursor-pointer group p-4 bg-white border border-stone-200 rounded-xl hover:border-[#8B7355]/30 transition-colors">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => { setUnderstood(e.target.checked); setConfirmDisable(false); }}
              className="w-5 h-5 rounded border-2 border-stone-300 text-[#8B7355] focus:ring-[#8B7355] mt-0.5"
            />
            <span className="text-sm font-normal text-stone-700 leading-relaxed group-hover:text-stone-900">
              {accountChoice === 'full'
                ? 'Entiendo y acepto que mis hijos están en Cuenta Libre'
                : 'Entiendo que mis hijos no tendrán cuenta en el kiosco y solo podrán pedir almuerzos'}
            </span>
          </label>

          {/* Botón de aceptar */}
          <Button
            onClick={handleAccept}
            disabled={!understood}
            className={`w-full h-14 text-base font-medium shadow-md rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed tracking-wide text-white ${
              accountChoice === 'kiosk'
                ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
                : 'bg-gradient-to-r from-[#8B7355] to-[#6B5744] hover:from-[#6B5744] hover:to-[#5B4734]'
            }`}
          >
            {accountChoice === 'kiosk' && confirmDisable
              ? '⚠️ Confirmar — Desactivar cuenta del kiosco'
              : accountChoice === 'kiosk'
              ? '🍽️ Continuar — Solo almuerzo'
              : 'Comenzar a Usar el Portal'}
          </Button>

          <p className="text-xs text-center text-stone-400 font-normal pt-2">
            Esta configuración es reversible. Puedes cambiarla cuando lo desees.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
