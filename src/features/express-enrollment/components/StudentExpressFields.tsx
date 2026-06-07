import { ShoppingCart, Utensils } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountMode } from "@/features/express-enrollment/services/expressEnrollmentService";

type Option = { id: string; name: string };

type StudentExpressFieldsProps = {
  studentFullName: string;
  schoolId: string;
  levelId: string;
  classroomId: string;
  accountMode: AccountMode;
  schools: Option[];
  levels: Option[];
  classrooms: Option[];
  loadingCatalogs: boolean;
  schoolLocked: boolean;
  onChange: (key: string, value: string) => void;
  onAccountModeChange: (mode: AccountMode) => void;
};

export function StudentExpressFields({
  studentFullName,
  schoolId,
  levelId,
  classroomId,
  accountMode,
  schools,
  levels,
  classrooms,
  loadingCatalogs,
  schoolLocked,
  onChange,
  onAccountModeChange,
}: StudentExpressFieldsProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-emerald-800">Datos del Alumno</h3>

      <div className="space-y-1.5">
        <Label className="text-xs">Nombre del alumno *</Label>
        <Input
          value={studentFullName}
          onChange={(e) => onChange("student_full_name", e.target.value)}
          placeholder="Ej: Mateo Ramirez"
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Sede *</Label>
        <Select
          value={schoolId || "none"}
          onValueChange={(v) => onChange("school_id", v === "none" ? "" : v)}
          disabled={schoolLocked}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Selecciona una sede" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" disabled>Selecciona una sede</SelectItem>
            {schools.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Nivel *</Label>
          <Select
            value={levelId || "none"}
            onValueChange={(v) => onChange("level_id", v === "none" ? "" : v)}
            disabled={!schoolId || loadingCatalogs}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={loadingCatalogs ? "Cargando..." : "Nivel"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>Nivel</SelectItem>
              {levels.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Aula *</Label>
          <Select
            value={classroomId || "none"}
            onValueChange={(v) => onChange("classroom_id", v === "none" ? "" : v)}
            disabled={!levelId || loadingCatalogs}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={loadingCatalogs ? "Cargando..." : "Aula"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>Aula</SelectItem>
              {classrooms.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Interruptor de tipo de cuenta — diseño compacto, cero scroll */}
      <div className="space-y-1.5">
        <Label className="text-xs">Tipo de cuenta *</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onAccountModeChange("concession_only")}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
              accountMode === "concession_only"
                ? "border-emerald-600 bg-emerald-50 text-emerald-800 font-semibold"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <Utensils className="h-3.5 w-3.5 shrink-0" />
            <span>Solo Almuerzos</span>
          </button>
          <button
            type="button"
            onClick={() => onAccountModeChange("kiosk_free")}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
              accountMode === "kiosk_free"
                ? "border-blue-600 bg-blue-50 text-blue-800 font-semibold"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
            <span>Consumo Libre</span>
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {accountMode === "concession_only"
            ? "Permite pedir almuerzos. Sin acceso a quiosco."
            : "Acceso libre al kiosco sin tope de consumo diario."}
        </p>
      </div>
    </div>
  );
}
