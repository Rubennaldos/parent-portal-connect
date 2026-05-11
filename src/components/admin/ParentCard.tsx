import { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Baby, Edit, UserCircle } from 'lucide-react';
import type { ParentSearchItem } from '@/hooks/useParentsSearch';

interface ParentCardProps {
  parent: ParentSearchItem;
  canEditParent: boolean;
  onViewChildren: (parent: ParentSearchItem) => void;
  onEditParent: (parent: ParentSearchItem) => void;
}

function ParentCardComponent({
  parent,
  canEditParent,
  onViewChildren,
  onEditParent,
}: ParentCardProps) {
  return (
    <Card className="border-l-4 border-blue-500">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{parent.full_name}</CardTitle>
            {parent.nickname && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <UserCircle className="h-3 w-3" />
                "{parent.nickname}"
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">
          <p><strong>DNI:</strong> {parent.dni || '-'}</p>
          <p><strong>Teléfono:</strong> {parent.phone_1 || '-'}</p>
          <p><strong>Sede:</strong> {parent.school_name || 'Sin asignar'}</p>
          <p className="flex items-center gap-1">
            <Baby className="h-4 w-4" />
            <strong>Hijos:</strong> {parent.children_count}
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewChildren(parent)}
            className="flex-1"
          >
            <Baby className="h-4 w-4 mr-1" />
            Ver Hijos
          </Button>
          {canEditParent && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEditParent(parent)}
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export const ParentCard = memo(
  ParentCardComponent,
  (prev, next) => (
    prev.parent.id === next.parent.id &&
    prev.parent.full_name === next.parent.full_name &&
    prev.parent.nickname === next.parent.nickname &&
    prev.parent.dni === next.parent.dni &&
    prev.parent.phone_1 === next.parent.phone_1 &&
    prev.parent.school_name === next.parent.school_name &&
    prev.parent.children_count === next.parent.children_count &&
    prev.canEditParent === next.canEditParent
  ),
);
