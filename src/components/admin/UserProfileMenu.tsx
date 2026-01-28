import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Settings, User, Lock, LogOut } from 'lucide-react';
import { ChangePasswordModal } from './ChangePasswordModal';
import { EditProfileModal } from './EditProfileModal';

interface UserProfileMenuProps {
  userEmail: string;
  userName?: string;
  onLogout: () => void;
}

export const UserProfileMenu = ({ userEmail, userName, onLogout }: UserProfileMenuProps) => {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Settings className="h-5 w-5 text-gray-700 hover:text-[#8B4513] transition-colors hover:rotate-90 duration-300" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{userName || 'Usuario'}</p>
              <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowEditProfile(true)}>
            <User className="mr-2 h-4 w-4" />
            <span>Editar Datos Personales</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
            <Lock className="mr-2 h-4 w-4" />
            <span>Cambiar Contraseña</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="text-red-600">
            <LogOut className="mr-2 h-4 w-4" />
            <span>Cerrar Sesión</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Modales */}
      <ChangePasswordModal 
        open={showChangePassword}
        onOpenChange={setShowChangePassword}
      />
      <EditProfileModal
        open={showEditProfile}
        onOpenChange={setShowEditProfile}
      />
    </>
  );
};
