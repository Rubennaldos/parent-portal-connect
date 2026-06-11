import { Loader2, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ParentExpressFields } from "./ParentExpressFields";
import { StudentExpressFields } from "./StudentExpressFields";
import { useExpressEnrollmentForm } from "../hooks/useExpressEnrollmentForm";

type ExpressEnrollmentModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  userRole?: string | null;
  userSchoolId?: string | null;
};

export function ExpressEnrollmentModal({
  open,
  onOpenChange,
  onSuccess,
  userRole,
  userSchoolId,
}: ExpressEnrollmentModalProps) {
  const {
    form,
    setField,
    setAccountMode,
    handleDniInput,
    submit,
    submitting,
    loadingCatalogs,
    schools,
    levels,
    filteredClassrooms,
    isSchoolRestricted,
  } = useExpressEnrollmentForm({
    isOpen: open,
    onSuccess,
    onClose: () => onOpenChange(false),
    userRole,
    userSchoolId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            Matriculacion Express
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registro rapido para consumo a credito en POS y visibilidad en Cobranzas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ParentExpressFields
            parentFullName={form.parent_full_name}
            parentDni={form.parent_dni}
            parentPhone1={form.parent_phone_1}
            parentPhone2={form.parent_phone_2}
            responsible2FullName={form.responsible_2_full_name}
            responsible2Dni={form.responsible_2_dni}
            responsible2Phone1={form.responsible_2_phone_1}
            onChange={setField}
            onDniChange={handleDniInput}
          />

          <StudentExpressFields
            studentFullName={form.student_full_name}
            schoolId={form.school_id}
            levelId={form.level_id}
            classroomId={form.classroom_id}
            accountMode={form.account_mode}
            schools={schools}
            levels={levels}
            classrooms={filteredClassrooms}
            loadingCatalogs={loadingCatalogs}
            schoolLocked={isSchoolRestricted}
            onChange={setField}
            onAccountModeChange={setAccountMode}
          />
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || loadingCatalogs}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Matriculando...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Matricular Alumno
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
