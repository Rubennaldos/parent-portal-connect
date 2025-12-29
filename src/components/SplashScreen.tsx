import { useState, useEffect } from 'react';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'logo' | 'fade-out'>('logo');

  useEffect(() => {
    // Fase 1: Mostrar logo con animación
    const fadeTimer = setTimeout(() => {
      setPhase('fade-out');
    }, 2000);

    // Fase 2: Completar splash
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 2800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-brand-cream via-white to-brand-cream transition-opacity duration-700 ${
        phase === 'fade-out' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Círculos decorativos de fondo */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-brand-teal/5 animate-pulse" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 rounded-full bg-brand-gold/5 animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>

      {/* Contenedor del logo */}
      <div 
        className={`relative flex flex-col items-center transition-all duration-1000 ease-out ${
          phase === 'fade-out' 
            ? 'scale-110 opacity-0 translate-y-[-20px]' 
            : 'scale-100 opacity-100 translate-y-0'
        }`}
      >
        {/* Logo con animación de entrada */}
        <div className="relative animate-logo-entrance">
          <img 
            src={limaCafeLogo} 
            alt="Lima Café 28" 
            className="w-48 h-48 object-contain drop-shadow-xl"
          />
          
          {/* Resplandor detrás del logo */}
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-gradient-to-br from-brand-teal to-brand-gold rounded-full scale-150 animate-glow" />
        </div>

        {/* Línea decorativa animada */}
        <div className="mt-8 flex items-center gap-3">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-brand-teal animate-line-expand" />
          <div className="w-2 h-2 rounded-full bg-brand-gold animate-pulse" />
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-brand-teal animate-line-expand" />
        </div>

        {/* Texto de bienvenida */}
        <p className="mt-6 text-brand-teal/70 font-medium tracking-widest text-sm uppercase animate-text-fade">
          Bienvenido
        </p>
      </div>
    </div>
  );
}
