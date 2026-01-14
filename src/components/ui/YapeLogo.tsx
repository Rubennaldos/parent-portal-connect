export const YapeLogo = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 200 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Fondo circular morado de Yape */}
    <circle cx="100" cy="100" r="95" fill="#6C1C8C" />
    
    {/* Letra Y estilizada de Yape en blanco */}
    <path
      d="M60 60 L80 60 L100 95 L120 60 L140 60 L100 120 L100 140 L80 140 L80 120 Z"
      fill="white"
      strokeWidth="0"
    />
  </svg>
);
