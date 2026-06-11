import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type CreateGhostParentInput = {
  supabaseAdmin: SupabaseClient;
  schoolId: string;
  dniNormalized: string;
  parentFullName: string;
  phone1: string;
  phone2?: string | null;
  responsible2FullName?: string | null;
  responsible2Dni?: string | null;
  responsible2Phone1?: string | null;
};

export type CreateGhostParentResult = {
  parentUserId: string;
  ghostEmail: string;
  createdNow: boolean;
};

const GHOST_DOMAIN = "kiosco.local";

function buildGhostEmail(dniNormalized: string): string {
  return `parent_${dniNormalized}@${GHOST_DOMAIN}`;
}

function buildRandomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Px!${token}A1`;
}

export async function createGhostParentIfNeeded(
  input: CreateGhostParentInput,
): Promise<CreateGhostParentResult> {
  const {
    supabaseAdmin,
    schoolId,
    dniNormalized,
    parentFullName,
    phone1,
    phone2,
    responsible2FullName,
    responsible2Dni,
    responsible2Phone1,
  } = input;

  const ghostEmail = buildGhostEmail(dniNormalized);
  let userId: string | null = null;
  let createdNow = false;

  const { data: createUserData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: ghostEmail,
    password: buildRandomPassword(),
    email_confirm: true,
    user_metadata: {
      role: "parent",
      full_name: parentFullName,
      dni: dniNormalized,
      express_enrollment: true,
      ghost_identity: true,
    },
  });

  if (createUserError) {
    const maybeAlreadyExists = createUserError.message.toLowerCase().includes("already");

    if (!maybeAlreadyExists) {
      throw new Error(`ghost auth create failed: ${createUserError.message}`);
    }

    const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", ghostEmail)
      .maybeSingle();

    if (existingProfileError || !existingProfile?.id) {
      throw new Error(
        `ghost auth exists but profile missing: ${existingProfileError?.message ?? "profile not found"}`,
      );
    }

    userId = existingProfile.id as string;
  } else {
    userId = createUserData.user?.id ?? null;
    createdNow = true;
  }

  if (!userId) {
    throw new Error("ghost user id not resolved");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email: ghostEmail,
        full_name: parentFullName,
        role: "parent",
        school_id: schoolId,
        is_active: true,
      },
      { onConflict: "id" },
    );

  if (profileError) {
    throw new Error(`profile upsert failed: ${profileError.message}`);
  }

  const { error: parentProfileError } = await supabaseAdmin
    .from("parent_profiles")
    .upsert(
      {
        id: userId,
        user_id: userId,
        school_id: schoolId,
        full_name: parentFullName,
        dni: dniNormalized,
        phone_1: phone1,
        phone_2: phone2 ?? null,
        responsible_2_full_name: responsible2FullName ?? null,
        responsible_2_dni: responsible2Dni ?? null,
        responsible_2_phone_1: responsible2Phone1 ?? null,
        approved_by_admin: true,
        onboarding_completed: false,
      },
      { onConflict: "id" },
    );

  if (parentProfileError) {
    throw new Error(`parent_profiles upsert failed: ${parentProfileError.message}`);
  }

  return {
    parentUserId: userId,
    ghostEmail,
    createdNow,
  };
}
