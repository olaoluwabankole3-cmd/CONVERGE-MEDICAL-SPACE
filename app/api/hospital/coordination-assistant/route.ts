import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

type WorkRow = {
  item_type: string;
  priority: string;
  status: string;
  owner_id: string | null;
  due_at: string | null;
  updated_at: string;
};
type AppointmentRow = {
  status: string;
  start_at: string;
  created_at: string;
};
type Brief = {
  headline: string;
  blockers: string[];
  nextStep: string;
  handoverDraft: string;
  verifyBeforeAction: string[];
};
type SafeContext = {
  requestType: string;
  requestStatus: string;
  hoursSinceSubmission: number;
  hoursSinceLastUpdate: number;
  openWorkCount: number;
  overdueWorkCount: number;
  unassignedWorkCount: number;
  highPriorityWorkCount: number;
  workItems: Array<{
    type: string;
    priority: string;
    status: string;
    ownerAssigned: boolean;
    overdue: boolean;
    hoursSinceUpdate: number;
  }>;
  appointment: null | {
    status: string;
    hoursUntilStart: number;
    hoursSinceProposal: number;
  };
};

const TERMINAL_REQUESTS = new Set(["completed", "no_show", "cancelled", "declined"]);
const TERMINAL_WORK = new Set(["resolved", "closed", "cancelled", "draft"]);
const HOSPITAL_RESPONSE_STATUSES = new Set(["submitted", "awaiting_hospital", "cancellation_requested"]);

function hoursSince(value: string | null | undefined, now: number): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (now - time) / 3_600_000) : 0;
}
function ageLabel(hours: number): string {
  if (hours < 1) return "less than one hour";
  if (hours < 24) return `${Math.floor(hours)} hours`;
  return `${Math.floor(hours / 24)} day(s)`;
}
function normalise(value: unknown): Brief | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.headline !== "string" || typeof item.nextStep !== "string" || typeof item.handoverDraft !== "string") return null;
  if (!Array.isArray(item.blockers) || !Array.isArray(item.verifyBeforeAction)) return null;
  const blockers = item.blockers.filter((x): x is string => typeof x === "string").slice(0, 4).map(x => x.slice(0, 260));
  const verify = item.verifyBeforeAction.filter((x): x is string => typeof x === "string").slice(0, 4).map(x => x.slice(0, 220));
  if (!blockers.length) blockers.push("No clear blocker was established from the available operational metadata.");
  return {
    headline: item.headline.slice(0, 180),
    blockers,
    nextStep: item.nextStep.slice(0, 600),
    handoverDraft: item.handoverDraft.slice(0, 1800),
    verifyBeforeAction: verify,
  };
}

function buildRulesBrief(context: SafeContext): Brief {
  const blockers: string[] = [];
  let nextStep = "Review the current request state and linked work, confirm who owns the next action, and record the outcome.";

  if (TERMINAL_REQUESTS.has(context.requestStatus)) {
    nextStep = "Confirm linked operational work is resolved and the final permitted patient update has been recorded.";
  } else if (HOSPITAL_RESPONSE_STATUSES.has(context.requestStatus)) {
    blockers.push(context.hoursSinceLastUpdate >= 24
      ? `The request has not had a recorded update for about ${ageLabel(context.hoursSinceLastUpdate)} while in a hospital-response state.`
      : `The current request state requires hospital-side review; the last recorded update was about ${ageLabel(context.hoursSinceLastUpdate)} ago.`);
    nextStep = "Review the request in the hospital inbox, confirm the next permitted action, and provide a patient-facing update when appropriate.";
  } else if (context.requestStatus === "awaiting_patient" || context.requestStatus === "appointment_proposed") {
    blockers.push("The workflow may be waiting for a patient response; a proposal must not be treated as a confirmed outcome.");
    nextStep = "Check for a patient response and make the next staff action explicit when the response arrives.";
  }

  if (context.appointment?.status === "patient_accepted") {
    blockers.push("A patient-accepted appointment proposal still needs explicit hospital confirmation.");
    nextStep = "Ask authorised scheduling staff to verify the slot against the hospital's actual scheduling process and explicitly confirm or respond.";
  }
  if (context.overdueWorkCount > 0) {
    blockers.push(`${context.overdueWorkCount} linked work item(s) are past their recorded due time.`);
    nextStep = "Review overdue linked work, confirm responsibility and agree an updated due time or next action.";
  }
  if (context.unassignedWorkCount > 0) {
    blockers.push(`${context.unassignedWorkCount} active linked work item(s) do not have an assigned owner.`);
  }
  if (context.highPriorityWorkCount > 0) {
    blockers.push(`${context.highPriorityWorkCount} active linked work item(s) carry a high or urgent operational priority label; these labels are not clinical triage.`);
  }
  if (blockers.length === 0) {
    blockers.push("The available workflow metadata does not show an obvious blocker. This does not prove that no issue exists.");
  }

  const workLines = context.workItems.slice(0, 5).map((item, index) =>
    `${index + 1}. ${item.type.replaceAll("_", " ")} — ${item.status.replaceAll("_", " ")}; ${item.priority} operational priority; ${item.ownerAssigned ? "owner assigned" : "unassigned"}${item.overdue ? "; overdue" : ""}.`
  );
  const handoverDraft = [
    `Current state: ${context.requestStatus.replaceAll("_", " ")} (${context.requestType.replaceAll("_", " ")} request).`,
    `Time since submission: about ${ageLabel(context.hoursSinceSubmission)}; time since last recorded update: about ${ageLabel(context.hoursSinceLastUpdate)}.`,
    `Coordination checks: ${blockers.slice(0, 3).join(" ")}`,
    workLines.length ? `Linked work: ${workLines.join(" ")}` : "Linked work: no active operational items were found.",
    `Suggested next step for staff review: ${nextStep}`,
  ].join("\n\n");

  return {
    headline: context.hoursSinceLastUpdate >= 24 && HOSPITAL_RESPONSE_STATUSES.has(context.requestStatus)
      ? "The request may be waiting too long for its next staff action"
      : context.overdueWorkCount > 0
        ? "Linked operational work has passed a recorded deadline"
        : context.unassignedWorkCount > 0
          ? "Responsibility for linked work needs to be made explicit"
          : "A focused coordination review is ready",
    blockers,
    nextStep,
    handoverDraft,
    verifyBeforeAction: [
      "Confirm the latest request status and any patient response in the workspace.",
      "Verify appointment availability with the responsible hospital team; do not treat a proposal as booked.",
      "Do not infer clinical urgency from operational status or priority labels.",
    ],
  };
}

async function buildAiBrief(context: SafeContext): Promise<Brief | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Converge's hospital operations coordination assistant.",
              "This is an operational workflow feature, not a clinical feature. Never provide diagnosis, treatment, triage, clinical risk scores, or clinical priority recommendations.",
              "Use only the supplied request/workflow status and timing metadata. No patient names, contact details, free-text patient messages, request subjects, clinical notes, staff names or database identifiers are provided.",
              "Do not invent causes for delays or claim an appointment is booked unless the supplied status explicitly supports that claim.",
              "Identify up to four potential coordination blockers, recommend one practical next step for authorised staff, and draft a concise internal handover note.",
              "The handover is a draft for human review. Do not issue commands, change records, or imply that a task has already been completed.",
              "Output valid JSON with headline, blockers (string array), nextStep, handoverDraft and verifyBeforeAction (string array).",
              "Be concise, factual, privacy-aware, and explicit about uncertainty.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Prepare an operational coordination brief for staff review.",
              privacy: "Only minimised workflow metadata; no patient-provided text, clinical information, names, contact details or record identifiers.",
              context,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return normalise(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedAdminContext();
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(hospitalId) || !uuid.test(requestId)) {
    return NextResponse.json({ error: "Choose a valid hospital and patient request." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(auth.admin, auth.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!["owner", "admin", "clinician", "operations", "reviewer"].includes(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role cannot access coordination analysis." }, { status: 403 });
  }

  const [requestResult, workResult, appointmentResult] = await Promise.all([
    auth.admin.from("patient_requests")
      .select("id,request_type,status,submitted_at,updated_at")
      .eq("hospital_id", resolved.hospital.id).eq("id", requestId).maybeSingle(),
    auth.admin.from("work_items")
      .select("item_type,priority,status,owner_id,due_at,updated_at")
      .eq("hospital_id", resolved.hospital.id).eq("patient_request_id", requestId)
      .order("created_at", { ascending: true }).limit(100),
    auth.admin.from("appointments")
      .select("status,start_at,created_at")
      .eq("hospital_id", resolved.hospital.id).eq("patient_request_id", requestId).maybeSingle(),
  ]);

  if (requestResult.error || workResult.error || appointmentResult.error) {
    return NextResponse.json({ error: "Unable to load request coordination context." }, { status: 500 });
  }
  if (!requestResult.data) return NextResponse.json({ error: "Request not found in this hospital." }, { status: 404 });

  const now = Date.now();
  const requestRow = requestResult.data;
  const allWork = (workResult.data ?? []) as WorkRow[];
  const activeWork = allWork.filter(item => !TERMINAL_WORK.has(item.status));
  const safeContext: SafeContext = {
    requestType: requestRow.request_type,
    requestStatus: requestRow.status,
    hoursSinceSubmission: Math.round(hoursSince(requestRow.submitted_at, now)),
    hoursSinceLastUpdate: Math.round(hoursSince(requestRow.updated_at, now)),
    openWorkCount: activeWork.length,
    overdueWorkCount: activeWork.filter(item => item.due_at && Date.parse(item.due_at) < now).length,
    unassignedWorkCount: activeWork.filter(item => !item.owner_id).length,
    highPriorityWorkCount: activeWork.filter(item => ["high", "urgent"].includes(item.priority)).length,
    workItems: activeWork.slice(0, 12).map(item => ({
      type: item.item_type,
      priority: item.priority,
      status: item.status,
      ownerAssigned: Boolean(item.owner_id),
      overdue: Boolean(item.due_at && Date.parse(item.due_at) < now),
      hoursSinceUpdate: Math.round(hoursSince(item.updated_at, now)),
    })),
    appointment: appointmentResult.data ? {
      status: appointmentResult.data.status,
      hoursUntilStart: Math.round((Date.parse(appointmentResult.data.start_at) - now) / 3_600_000),
      hoursSinceProposal: Math.round(hoursSince(appointmentResult.data.created_at, now)),
    } : null,
  };

  const ai = await buildAiBrief(safeContext);
  const result = ai ?? buildRulesBrief(safeContext);
  const mode = ai ? "ai" : "rules";
  const { error: auditError } = await auth.admin.from("audit_events").insert({
    hospital_id: resolved.hospital.id,
    actor_id: auth.user.id,
    entity_type: "patient_request",
    entity_id: requestId,
    action: "coordination_brief_generated",
    details: {
      mode,
      request_status: requestRow.status,
      request_type: requestRow.request_type,
      open_work_count: safeContext.openWorkCount,
      overdue_work_count: safeContext.overdueWorkCount,
      unassigned_work_count: safeContext.unassignedWorkCount,
    },
  });

  return NextResponse.json({
    ...result,
    mode,
    generatedAt: new Date(now).toISOString(),
    auditRecorded: !auditError,
    privacyNote: "Only operational workflow metadata was analysed. No patient identifiers, request text, messages or clinical notes were included.",
  }, { headers: { "Cache-Control": "no-store" } });
}
