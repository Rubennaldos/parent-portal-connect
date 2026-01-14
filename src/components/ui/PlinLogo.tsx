export const PlinLogo = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 200 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Fondo circular celeste de Plin */}
    <circle cx="100" cy="100" r="95" fill="#00D4D8" />
    
    {/* Letra P estilizada de Plin en blanco */}
    <path
      d="M70 60 L110 60 Q130 60 140 75 Q150 90 140 105 Q130 120 110 120 L90 120 L90 140 L70 140 Z M90 80 L90 100 L110 100 Q120 100 125 92.5 Q130 85 125 77.5 Q120 80 110 80 Z"
      fill="white"
      strokeWidth="0"
    />
  </svg>
);
