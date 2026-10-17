import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type HospitalSummary = {
  id: string;
  name: string;
  status: string;
  city: string | null;
  country: string;
};

export async function resolveActiveHospital(
  admin: SupabaseClient,
  userId: string,
  requestedHospitalId?: string,
): Promise<
  | { hospital: HospitalSummary; role: string }
  | { response: NextResponse }
> {
  const { data: memberships, error: membershipError } = await admin
    .from("hospital_memberships")
    .select("hospital_id,role,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (membershipError) {
    return { response: NextResponse.json({ error: "Unable to verify hospital membership." }, { status: 500 }) };
  }

  const matching = (memberships ?? []).filter(
    membership => !requestedHospitalId || membership.hospital_id === requestedHospitalId,
  );
  if (!matching.length) {
    return { response: NextResponse.json({ error: "You do not have access to this hospital workspace." }, { status: 403 }) };
  }

  const hospitalIds = [...new Set(matching.map(item => item.hospital_id))];
  const { data: hospitals, error: hospitalsError } = await admin
    .from("hospitals")
    .select("id,name,status,city,country")
    .in("id", hospitalIds)
    .eq("status", "active");

  if (hospitalsError) {
    return { response: NextResponse.json({ error: "Unable to verify hospital status." }, { status: 500 }) };
  }

  const activeById = new Map((hospitals ?? []).map(hospital => [hospital.id, hospital]));
  const selectedMembership = matching.find(item => activeById.has(item.hospital_id));
  if (!selectedMembership) {
    return { response: NextResponse.json({ error: "An active hospital workspace is required." }, { status: 409 }) };
  }

  const hospital = activeById.get(selectedMembership.hospital_id);
  if (!hospital) {
    return { response: NextResponse.json({ error: "An active hospital workspace is required." }, { status: 409 }) };
  }

  return { hospital: hospital as HospitalSummary, role: selectedMembership.role };
}
