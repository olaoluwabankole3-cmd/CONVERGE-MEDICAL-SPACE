import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(["resolved", "closed"]);

type WorkRow = {
  id: string;
  hospital_id: string;
  reference_code: string;
  title: string;
  summary: string | null;
  item_type: string;
  priority: string;
  status: string;
  owner_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

function workSignals(rows: WorkRow[], now: number) {
  const actionable = rows.filter(item => !TERMINAL_STATUSES.has(item.status));
  const overdue = actionable.filter(item => !!item.due_at && Date.parse(item.due_at) < now);
  const dueSoon = actionable.filter(item => {
    if (!item.due_at) return false;
    const due = Date.parse(item.due_at);
    return due >= now && due <= now + 48 * 60 * 60 * 1000;
  });
  return {
    assignedOpen: actionable.length,
    dueSoon: dueSoon.length,
    overdue: overdue.length,
    highPriority: actionable.filter(item => ["high", "urgent"].includes(item.priority)).length,
  };
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;

  const { data, error } = await context.admin
    .from("work_items")
    .select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,due_at,created_at,updated_at")
    .eq("hospital_id", resolved.hospital.id)
    .eq("owner_id", context.user.id)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Unable to load your assigned work." }, { status: 500 });
  }

  const items = (data ?? []) as WorkRow[];
  const now = Date.now();
  return NextResponse.json({
    hospital: resolved.hospital,
    role: resolved.role,
    generatedAt: new Date(now).toISOString(),
    metrics: workSignals(items, now),
    items,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const workItemId = typeof body.workItemId === "string" ? body.workItemId : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!UUID_PATTERN.test(hospitalId) || !UUID_PATTERN.test(workItemId) || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Provide a valid hospital, work item, and status." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;

  const { data, error } = await context.admin.rpc("update_my_assigned_work_item_status", {
    p_actor_user_id: context.user.id,
    p_hospital_id: resolved.hospital.id,
    p_work_item_id: workItemId,
    p_next_status: status,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Unable to update this assigned work item." }, { status: 400 });
  }

  return NextResponse.json({ workItem: data });
}
