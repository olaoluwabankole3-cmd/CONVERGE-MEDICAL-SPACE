import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "admin", "clinician", "operations"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function parseDueAt(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() <= Date.now()) return undefined;
  return date.toISOString();
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

  if (!hospitalId) {
    return NextResponse.json({ error: "A hospital workspace is required." }, { status: 400 });
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

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!ALLOWED_ROLES.has(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role is read-only for task creation." }, { status: 403 });
  }

  const { data, error } = await context.admin.rpc("create_operations_follow_up_task", {
    p_actor_user_id: context.user.id,
    p_hospital_id: resolved.hospital.id,
    p_title: title,
    p_summary: summary,
    p_priority: priority,
    p_due_at: dueAt,
    p_source_recommendation: sourceRecommendation,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to create the follow-up task." },
      { status: 400 },
    );
  }

  return NextResponse.json({ workItem: data }, { status: 201 });
}
