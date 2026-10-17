import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "admin", "clinician", "operations"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDueAt(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() <= Date.now()) return undefined;
  return date.toISOString();
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? "";
  if (!UUID_PATTERN.test(hospitalId)) {
    return NextResponse.json({ error: "A valid hospital workspace is required." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!ALLOWED_ROLES.has(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role cannot create or assign follow-up tasks." }, { status: 403 });
  }

  const { data: memberships, error } = await context.admin
    .from("hospital_memberships")
    .select("user_id,role")
    .eq("hospital_id", resolved.hospital.id)
    .in("role", ["owner", "admin", "clinician", "operations"])
    .order("role", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Unable to load operational staff for assignment." }, { status: 500 });
  }

  const members = await Promise.all((memberships ?? []).map(async member => {
    const { data } = await context.admin.auth.admin.getUserById(member.user_id);
    const metadata = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
    const displayNameValue = typeof metadata.name === "string" ? metadata.name.trim() : "";
    const displayName = (fullName || displayNameValue || data.user?.email || `Hospital staff · ${member.user_id.slice(0, 8)}`).slice(0, 120);
    return {
      userId: member.user_id,
      role: member.role,
      displayName,
    };
  }));

  return NextResponse.json({
    hospitalId: resolved.hospital.id,
    members,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const sourceRecommendation = typeof body.sourceRecommendation === "string"
    ? body.sourceRecommendation.trim()
    : "";
  const priority = typeof body.priority === "string" ? body.priority : "medium";
  const dueAt = parseDueAt(body.dueAt);
  const ownerUserId = body.ownerUserId === null || body.ownerUserId === undefined || body.ownerUserId === ""
    ? null
    : typeof body.ownerUserId === "string" ? body.ownerUserId : undefined;

  if (!UUID_PATTERN.test(hospitalId)) {
    return NextResponse.json({ error: "A valid hospital workspace is required." }, { status: 400 });
  }
  if (title.length < 3 || title.length > 240) {
    return NextResponse.json({ error: "Task title must be between 3 and 240 characters." }, { status: 400 });
  }
  if (summary.length < 3 || summary.length > 3000) {
    return NextResponse.json({ error: "Task details must be between 3 and 3000 characters." }, { status: 400 });
  }
  if (sourceRecommendation.length < 3 || sourceRecommendation.length > 160) {
    return NextResponse.json({ error: "A valid source recommendation title is required." }, { status: 400 });
  }
  if (!PRIORITIES.has(priority)) {
    return NextResponse.json({ error: "Choose a valid task priority." }, { status: 400 });
  }
  if (dueAt === undefined) {
    return NextResponse.json({ error: "Choose a valid future due date or leave it blank." }, { status: 400 });
  }
  if (ownerUserId === undefined || (ownerUserId !== null && !UUID_PATTERN.test(ownerUserId))) {
    return NextResponse.json({ error: "Choose a valid staff member or leave the task unassigned." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!ALLOWED_ROLES.has(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role is read-only for task creation." }, { status: 403 });
  }

  const { data, error } = await context.admin.rpc("create_assigned_operations_follow_up_task", {
    p_actor_user_id: context.user.id,
    p_hospital_id: resolved.hospital.id,
    p_title: title,
    p_summary: summary,
    p_priority: priority,
    p_due_at: dueAt,
    p_source_recommendation: sourceRecommendation,
    p_owner_user_id: ownerUserId,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to create the follow-up task." },
      { status: 400 },
    );
  }

  return NextResponse.json({ workItem: data }, { status: 201 });
}
