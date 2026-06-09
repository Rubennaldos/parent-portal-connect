import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  enrollStudentExpress,
  ExpressEnrollmentServiceError,
  type AccountMode,
} from "../services/expressEnrollmentService";

type School = { id: string; name: string };
type Level = { id: string; name: string; school_id: string };
type Classroom = { id: string; name: string; level_id: string };

type UseExpressEnrollmentFormParams = {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
  userRole?: string | null;
  userSchoolId?: string | null;
};

type FormState = {
  parent_full_name: string;
  parent_dni: string;
  parent_phone_1: string;
  parent_phone_2: string;
  responsible_2_full_name: string;
  responsible_2_dni: string;
  responsible_2_phone_1: string;
  student_full_name: string;
  school_id: string;
  level_id: string;
  classroom_id: string;
  account_mode: AccountMode;
};

const initialForm: FormState = {
  parent_full_name: "",
  parent_dni: "",
  parent_phone_1: "",
  parent_phone_2: "",
  responsible_2_full_name: "",
  responsible_2_dni: "",
  responsible_2_phone_1: "",
  student_full_name: "",
  school_id: "",
  level_id: "",
  classroom_id: "",
  account_mode: "concession_only",
};

function formatErrorMessage(code?: string, fallback?: string): string {
  if (code === "ERR_EXPRESS_UNAUTHORIZED") return fallback || "No tienes permisos para usar esta función.";
  if (code === "ERR_EXPRESS_INVALID_DNI") return "El DNI es inválido. Debe tener 8 o 9 dígitos.";
  if (code === "ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS") {
    return "DNI duplicado ambiguo en la sede. Usa el panel avanzado para resolverlo.";
  }
  if (code === "ERR_EXPRESS_INVALID_HIERARCHY") {
    return "La combinación de sede, nivel y aula no es válida.";
  }
  return fallback || "No se pudo matricular al alumno.";
}

export function useExpressEnrollmentForm({
  isOpen,
  onSuccess,
  onClose,
  userRole,
  userSchoolId,
}: UseExpressEnrollmentFormParams) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  const [schools, setSchools] = useState<School[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isCrossSchoolRole = userRole === "admin_general" || userRole === "superadmin";
  const isSchoolRestricted = !isCrossSchoolRole;

  const filteredClassrooms = useMemo(
    () => classrooms.filter((c) => c.level_id === form.level_id),
    [classrooms, form.level_id],
  );

  const setAccountMode = (mode: AccountMode) => {
    setForm((prev) => ({ ...prev, account_mode: mode }));
  };

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };

      if (key === "school_id") {
        if (isSchoolRestricted) return prev;
        next.level_id = "";
        next.classroom_id = "";
      }
      if (key === "level_id") {
        next.classroom_id = "";
      }
      return next;
    });
  };

  const handleDniInput = (value: string, key: "parent_dni" | "responsible_2_dni") => {
    const numeric = value.replace(/\D/g, "").slice(0, 9);
    setField(key, numeric);
  };

  const resetForm = () => setForm(initialForm);

  useEffect(() => {
    if (!isOpen || !supabase) return;

    const loadSchools = async () => {
      setLoadingCatalogs(true);
      const { data, error } = await supabase
        .from("schools")
        .select("id, name")
        .order("name");

      setLoadingCatalogs(false);

      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar las sedes.",
        });
        return;
      }

      const allSchools = (data ?? []) as School[];

      if (isSchoolRestricted) {
        if (!userSchoolId) {
          setSchools([]);
          setForm((prev) => ({ ...prev, school_id: "", level_id: "", classroom_id: "" }));
          toast({
            variant: "destructive",
            title: "Acceso restringido",
            description: "Tu usuario no tiene sede asignada para matrícula express.",
          });
          return;
        }

        const own = allSchools.filter((s) => s.id === userSchoolId);
        setSchools(own);
        setForm((prev) => ({
          ...prev,
          school_id: userSchoolId,
          level_id: prev.school_id === userSchoolId ? prev.level_id : "",
          classroom_id: prev.school_id === userSchoolId ? prev.classroom_id : "",
        }));
        return;
      }

      setSchools(allSchools);
    };

    loadSchools();
  }, [isOpen, isSchoolRestricted, toast, userSchoolId]);

  useEffect(() => {
    if (!isOpen || !supabase || !form.school_id) {
      setLevels([]);
      setClassrooms([]);
      return;
    }

    const loadLevelsAndClassrooms = async () => {
      setLoadingCatalogs(true);

      const [levelsRes, classroomsRes] = await Promise.all([
        supabase
          .from("school_levels")
          .select("id, name, school_id")
          .eq("school_id", form.school_id)
          .eq("is_active", true)
          .order("order_index"),
        supabase
          .from("school_classrooms")
          .select("id, name, level_id")
          .eq("school_id", form.school_id)
          .eq("is_active", true)
          .order("order_index"),
      ]);

      setLoadingCatalogs(false);

      if (levelsRes.error || classroomsRes.error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar niveles y aulas.",
        });
        return;
      }

      const lv = (levelsRes.data ?? []) as Level[];
      setLevels(lv);

      const levelIds = new Set(lv.map((l) => l.id));
      const allClassrooms = (classroomsRes.data ?? []) as Classroom[];
      setClassrooms(allClassrooms.filter((c) => levelIds.has(c.level_id)));
    };

    loadLevelsAndClassrooms();
  }, [form.school_id, isOpen, toast]);

  const submit = async () => {
    if (!form.parent_full_name.trim() || !form.parent_phone_1.trim()) {
      toast({ variant: "destructive", title: "Campos requeridos", description: "Completa los datos obligatorios del padre." });
      return;
    }

    if (form.parent_dni.length < 8 || form.parent_dni.length > 9) {
      toast({ variant: "destructive", title: "DNI inválido", description: "El DNI debe tener 8 o 9 dígitos." });
      return;
    }

    if (!form.student_full_name.trim() || !form.school_id || !form.level_id || !form.classroom_id) {
      toast({ variant: "destructive", title: "Campos requeridos", description: "Completa los datos obligatorios del alumno." });
      return;
    }

    try {
      setSubmitting(true);

      const result = await enrollStudentExpress({
        school_id: form.school_id,
        student_full_name: form.student_full_name.trim(),
        level_id: form.level_id,
        classroom_id: form.classroom_id,
        account_mode: form.account_mode,
        parent: {
          full_name: form.parent_full_name.trim(),
          dni: form.parent_dni,
          phone_1: form.parent_phone_1.trim(),
          phone_2: form.parent_phone_2.trim() || null,
          responsible_2_full_name: form.responsible_2_full_name.trim() || null,
          responsible_2_dni: form.responsible_2_dni.trim() || null,
          responsible_2_phone_1: form.responsible_2_phone_1.trim() || null,
        },
      });

      toast({
        title: "Matrícula express exitosa",
        description: `Alumno registrado en ${result.grade} - ${result.section}.`,
      });

      resetForm();
      onSuccess?.();
      onClose?.();
    } catch (e) {
      const err = e as ExpressEnrollmentServiceError;
      toast({
        variant: "destructive",
        title: err.code || "Error",
        description: formatErrorMessage(err.code, err.message),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    setField,
    setAccountMode,
    handleDniInput,
    submit,
    resetForm,
    submitting,
    loadingCatalogs,
    schools,
    levels,
    filteredClassrooms,
    isSchoolRestricted,
  };
}
