import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type ParentExpressFieldsProps = {
  parentFullName: string;
  parentDni: string;
  parentPhone1: string;
  parentPhone2: string;
  responsible2FullName: string;
  responsible2Dni: string;
  responsible2Phone1: string;
  onChange: (key: string, value: string) => void;
  onDniChange: (value: string, key: "parent_dni" | "responsible_2_dni") => void;
};

export function ParentExpressFields({
  parentFullName,
  parentDni,
  parentPhone1,
  parentPhone2,
  responsible2FullName,
  responsible2Dni,
  responsible2Phone1,
  onChange,
  onDniChange,
}: ParentExpressFieldsProps) {
  const dniLen = parentDni.length;
  const dniInvalid = dniLen > 0 && (dniLen < 8 || dniLen > 9);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-emerald-800">Datos del Padre</h3>

      <div className="space-y-1.5">
        <Label className="text-xs">Nombre completo *</Label>
        <Input
          value={parentFullName}
          onChange={(e) => onChange("parent_full_name", e.target.value)}
          placeholder="Ej: Carlos Ramirez"
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">DNI *</Label>
        <Input
          value={parentDni}
          onChange={(e) => onDniChange(e.target.value, "parent_dni")}
          inputMode="numeric"
          maxLength={9}
          placeholder="Solo numeros"
          className="h-8 text-sm"
        />
        {dniInvalid && (
          <p className="text-xs text-red-600">Debe tener 8 o 9 digitos.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Telefono principal *</Label>
        <Input
          value={parentPhone1}
          onChange={(e) => onChange("parent_phone_1", e.target.value)}
          placeholder="Ej: 999888777"
          className="h-8 text-sm"
        />
      </div>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="optional" className="border rounded-md px-3">
          <AccordionTrigger className="text-xs text-muted-foreground py-2 hover:no-underline">
            Datos opcionales (tel. secundario / responsable 2)
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Telefono secundario</Label>
              <Input
                value={parentPhone2}
                onChange={(e) => onChange("parent_phone_2", e.target.value)}
                placeholder="Opcional"
                className="h-8 text-sm"
              />
            </div>

            <p className="text-xs font-medium text-emerald-700 pt-1">Responsable 2</p>

            <div className="space-y-1.5">
              <Label className="text-xs">Nombre completo</Label>
              <Input
                value={responsible2FullName}
                onChange={(e) => onChange("responsible_2_full_name", e.target.value)}
                placeholder="Opcional"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">DNI</Label>
              <Input
                value={responsible2Dni}
                onChange={(e) => onDniChange(e.target.value, "responsible_2_dni")}
                inputMode="numeric"
                maxLength={9}
                placeholder="Solo numeros"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Telefono</Label>
              <Input
                value={responsible2Phone1}
                onChange={(e) => onChange("responsible_2_phone_1", e.target.value)}
                placeholder="Opcional"
                className="h-8 text-sm"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
