import { NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const { data: memberships, error: membershipsError } = await context.admin
    .from("hospital_memberships")
    .select("hospital_id,role,created_at")
    .eq("user_id", context.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (membershipsError) {
    return NextResponse.json({ error: "Unable to load your hospital workspaces." }, { status: 500 });
  }

  const rows = memberships ?? [];
  if (!rows.length) {
    return NextResponse.json({ workspaces: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const hospitalIds = [...new Set(rows.map(item => item.hospital_id))];
  const { data: hospitals, error: hospitalsError } = await context.admin
    .from("hospitals")
    .select("id,name,status,city,country")
    .in("id", hospitalIds);

  if (hospitalsError) {
    return NextResponse.json({ error: "Unable to load hospital details." }, { status: 500 });
  }

  const hospitalById = new Map((hospitals ?? []).map(hospital => [hospital.id, hospital]));
  const workspaces = rows.flatMap(membership => {
    const hospital = hospitalById.get(membership.hospital_id);
    if (!hospital) return [];
    return [{
      id: hospital.id,
      name: hospital.name,
      status: hospital.status,
      city: hospital.city,
      country: hospital.country,
      role: membership.role,
      membershipCreatedAt: membership.created_at,
    }];
  });

  return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "no-store" } });
}
