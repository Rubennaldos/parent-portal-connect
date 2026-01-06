import { Badge } from '@/components/ui/badge';
import { APP_CONFIG } from '@/config/app.config';

interface VersionBadgeProps {
  className?: string;
  showFull?: boolean;
}

export function VersionBadge({ className = '', showFull = false }: VersionBadgeProps) {
  return (
    <Badge 
      variant="outline" 
      className={`font-mono text-xs ${className}`}
    >
      {showFull ? APP_CONFIG.fullVersion : `v${APP_CONFIG.version}`}
    </Badge>
  );
}

