import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

type PatientRequestRow = {
  id: string;
  status: string;
  request_type: string;
  submitted_at: string;
  updated_at: string;
};

type WorkItemRow = {
  item_type: string;
  status: string;
  priority: string;
  due_at: string | null;
  owner_id: string | null;
};

type AppointmentRow = {
  patient_request_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type OperationalMetrics = {
  totalRequests: number;
  openRequests: number;
  needsHospitalResponse: number;
  awaitingPatient: number;
  waitingOnHospitalOver24Hours: number;
  overdueFollowUps: number;
  highPriorityOpenWorkItems: number;
  unassignedOpenWorkItems: number;
  patientAcceptedAppointmentsNeedingConfirmation: number;
  appointmentProposalsAwaitingPatient: number;
  requestsByStatus: Record<string, number>;
  requestsByType: Record<string, number>;
};

type Insight = {
  title: string;
  priority: "high" | "medium" | "low";
  evidence: string;
  recommendation: string;
};

type Analysis = {
  headline: string;
  summary: string;
  insights: Insight[];
  nextSteps: string[];
};

const TERMINAL_REQUEST_STATUSES = new Set(["completed", "no_show", "cancelled", "declined"]);
const TERMINAL_WORK_STATUSES = new Set(["resolved", "closed", "cancelled"]);
const WAITING_FOR_HOSPITAL = new Set(["submitted", "awaiting_hospital", "cancellation_requested"]);

function ageHours(value: string | null | undefined, now: number): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 3_600_000) : 0;
}

function countBy(rows: Array<{ [key: string]: unknown }>, key: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = String(row[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildMetrics(
  requests: PatientRequestRow[],
  workItems: WorkItemRow[],
  appointments: AppointmentRow[],
  now: number,
): OperationalMetrics {
  const openRequests = requests.filter(row => !TERMINAL_REQUEST_STATUSES.has(row.status));
  return {
    totalRequests: requests.length,
    openRequests: openRequests.length,
    needsHospitalResponse: requests.filter(row => WAITING_FOR_HOSPITAL.has(row.status)).length,
    awaitingPatient: requests.filter(row => row.status === "awaiting_patient" || row.status === "appointment_proposed").length,
    waitingOnHospitalOver24Hours: requests.filter(row =>
      WAITING_FOR_HOSPITAL.has(row.status) && ageHours(row.submitted_at, now) >= 24,
    ).length,
    overdueFollowUps: workItems.filter(row =>
      (row.item_type === "follow_up" || row.item_type === "task") &&
      !!row.due_at && Date.parse(row.due_at) < now && !TERMINAL_WORK_STATUSES.has(row.status),
    ).length,
    highPriorityOpenWorkItems: workItems.filter(row =>
      ["high", "urgent"].includes(row.priority) && !TERMINAL_WORK_STATUSES.has(row.status),
    ).length,
    unassignedOpenWorkItems: workItems.filter(row =>
      !row.owner_id && !TERMINAL_WORK_STATUSES.has(row.status),
    ).length,
    patientAcceptedAppointmentsNeedingConfirmation: appointments.filter(row => row.status === "patient_accepted").length,
    appointmentProposalsAwaitingPatient: appointments.filter(row => row.status === "proposed").length,
    requestsByStatus: countBy(requests as unknown as Array<Record<string, unknown>>, "status"),
    requestsByType: countBy(requests as unknown as Array<Record<string, unknown>>, "request_type"),
  };
}

function buildRuleBasedAnalysis(metrics: OperationalMetrics): Analysis {
  const insights: Insight[] = [];
  const nextSteps: string[] = [];

  if (metrics.waitingOnHospitalOver24Hours > 0) {
    insights.push({
      title: "Requests are waiting for a hospital response",
      priority: "high",
      evidence: `${metrics.waitingOnHospitalOver24Hours} request(s) in a hospital-response state have been open for at least 24 hours.`,
      recommendation: "Review the oldest requests first and assign an accountable staff member for each outstanding response.",
    });
    nextSteps.push("Triage the oldest requests and record an owner for each next step.");
  } else if (metrics.needsHospitalResponse > 0) {
    insights.push({
      title: "Incoming requests need triage",
      priority: "medium",
      evidence: `${metrics.needsHospitalResponse} request(s) currently need a hospital-side response.`,
      recommendation: "Review the inbox and either begin review, request missing information, or propose a next step.",
    });
    nextSteps.push("Review the hospital-response queue and make the next step explicit.");
  }

  if (metrics.patientAcceptedAppointmentsNeedingConfirmation > 0) {
    insights.push({
      title: "Accepted appointment proposals need confirmation",
      priority: "high",
      evidence: `${metrics.patientAcceptedAppointmentsNeedingConfirmation} patient-accepted appointment(s) are not yet marked confirmed.`,
      recommendation: "Verify the proposed slot against the hospital's real scheduling process, then confirm it in the workspace. Do not treat acceptance as a confirmed booking.",
    });
    nextSteps.push("Resolve patient-accepted appointment proposals with the scheduling team.");
  }

  if (metrics.overdueFollowUps > 0) {
    insights.push({
      title: "Follow-ups or tasks are overdue",
      priority: metrics.overdueFollowUps >= 5 ? "high" : "medium",
      evidence: `${metrics.overdueFollowUps} open follow-up/task item(s) have a due time in the past.`,
      recommendation: "Review overdue items, update their due dates where appropriate, and assign a responsible owner.",
    });
    nextSteps.push("Review overdue follow-ups and confirm ownership and due dates.");
  }

  if (metrics.highPriorityOpenWorkItems > 0) {
    insights.push({
      title: "High-priority operational work remains open",
      priority: metrics.highPriorityOpenWorkItems >= 5 ? "high" : "medium",
      evidence: `${metrics.highPriorityOpenWorkItems} open work item(s) are marked high or urgent.`,
      recommendation: "Check priority, ownership, and the next operational action for each item. Priority labels are workload signals, not clinical triage.",
    });
    nextSteps.push("Check high-priority work for a named owner and a clear next action.");
  }

  if (metrics.unassignedOpenWorkItems > 0) {
    insights.push({
      title: "Some open work has no assigned owner",
      priority: metrics.unassignedOpenWorkItems >= 5 ? "high" : "medium",
      evidence: `${metrics.unassignedOpenWorkItems} unresolved work item(s) have no assigned staff owner.`,
      recommendation: "Assign operational ownership so that follow-up does not depend on someone noticing an unclaimed item.",
    });
    nextSteps.push("Assign owners to unassigned open work.");
  }

  if (insights.length === 0) {
    insights.push({
      title: metrics.totalRequests === 0 ? "No patient requests to analyse yet" : "No rule-based bottlenecks detected",
      priority: "low",
      evidence: metrics.totalRequests === 0
        ? "The workspace currently has no patient requests."
        : "The tracked response-age, overdue-task, priority, assignment, and appointment-confirmation checks found no current flags.",
      recommendation: metrics.totalRequests === 0
        ? "Use a synthetic patient account to submit a request, then test the staff review and response workflow."
        : "Continue routine review. These checks cover workflow signals only and do not prove that the service is operating without issues.",
    });
    nextSteps.push(metrics.totalRequests === 0
      ? "Run one end-to-end synthetic patient request to validate the workflow."
      : "Recheck the queue regularly and review the underlying records when needed.");
  }

  return {
    headline: metrics.openRequests > 0
      ? `${metrics.openRequests} open request(s) across the workflow`
      : "No open patient requests",
    summary: "This read-only review uses aggregate workflow counts and timing signals. It does not read patient names, contact details, request subjects, message content, or clinical notes, and it does not change records.",
    insights: insights.slice(0, 6),
    nextSteps: [...new Set(nextSteps)].slice(0, 4),
  };
}

function normaliseModelAnalysis(value: unknown): Analysis | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.headline !== "string" || typeof row.summary !== "string" || !Array.isArray(row.insights)) return null;

  const insights: Insight[] = row.insights.slice(0, 5).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const insight = item as Record<string, unknown>;
    if (typeof insight.title !== "string" || typeof insight.evidence !== "string" || typeof insight.recommendation !== "string") return [];
    const priority = insight.priority === "high" || insight.priority === "medium" || insight.priority === "low"
      ? insight.priority : "medium";
    return [{
      title: insight.title.slice(0, 140),
      priority,
      evidence: insight.evidence.slice(0, 320),
      recommendation: insight.recommendation.slice(0, 500),
    }];
  });

  const nextSteps = Array.isArray(row.nextSteps)
    ? row.nextSteps.filter((item): item is string => typeof item === "string").slice(0, 4).map(item => item.slice(0, 240))
    : [];
  if (!insights.length) return null;
  return {
    headline: row.headline.slice(0, 140),
    summary: row.summary.slice(0, 650),
    insights,
    nextSteps,
  };
}

async function buildAiAnalysis(metrics: OperationalMetrics): Promise<Analysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are an operations analyst for a hospital workflow product.",
              "Use only the supplied aggregate operational metrics. Do not claim facts not supported by those counts.",
              "Do not provide diagnosis, treatment, clinical triage, or patient-specific advice.",
              "Never recommend autonomous changes. Recommendations must be reviewed and carried out by authorised staff.",
              "Do not infer why a delay happened; describe it as a signal and suggest verification.",
              "Output a JSON object with headline, summary, insights (array of title, priority high|medium|low, evidence, recommendation), and nextSteps (string array).",
              "Keep it concise and practical. If no material issue is present, say so with appropriate caveats.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Identify administrative workflow bottlenecks and safe next steps.",
              privacy: "These are aggregate counts only. No patient or request-level records are included.",
              metrics,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return normaliseModelAnalysis(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const requestedHospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, requestedHospitalId);
  if ("response" in resolved) return resolved.response;

  if (!["owner", "admin", "clinician", "operations", "reviewer"].includes(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role cannot access operational analysis." }, { status: 403 });
  }

  const hospitalId = resolved.hospital.id;
  const [requestResult, workResult, appointmentResult] = await Promise.all([
    context.admin.from("patient_requests")
      .select("id,status,request_type,submitted_at,updated_at")
      .eq("hospital_id", hospitalId)
      .order("submitted_at", { ascending: false })
      .limit(5000),
    context.admin.from("work_items")
      .select("item_type,status,priority,due_at,owner_id")
      .eq("hospital_id", hospitalId)
      .limit(5000),
    context.admin.from("appointments")
      .select("patient_request_id,status,created_at,updated_at")
      .eq("hospital_id", hospitalId)
      .limit(5000),
  ]);

  if (requestResult.error || workResult.error || appointmentResult.error) {
    return NextResponse.json({ error: "Unable to calculate operational signals for this hospital." }, { status: 500 });
  }

  const requests = (requestResult.data ?? []) as PatientRequestRow[];
  const workItems = (workResult.data ?? []) as WorkItemRow[];
  const appointments = (appointmentResult.data ?? []) as AppointmentRow[];
  const now = Date.now();
  const metrics = buildMetrics(requests, workItems, appointments, now);
  const aiAnalysis = await buildAiAnalysis(metrics);
  const analysis = aiAnalysis ?? buildRuleBasedAnalysis(metrics);
  const mode = aiAnalysis ? "ai" : "rules";
  const note = aiAnalysis
    ? "AI analysis received only aggregate counts and status totals; no patient-level text or identifiers were sent to the model."
    : process.env.OPENAI_API_KEY
      ? "The AI provider did not return a usable response. Showing transparent rule-based signals instead."
      : "OPENAI_API_KEY is not configured on the server. Showing rule-based operational signals; no external AI call was made.";

  // Record that an operations analysis was requested without storing its generated prose.
  const { error: auditError } = await context.admin.from("audit_events").insert({
    hospital_id: hospitalId,
    actor_id: context.user.id,
    entity_type: "operations_insights",
    entity_id: hospitalId,
    action: "operations_insights_generated",
    details: { mode, request_count: metrics.totalRequests, open_request_count: metrics.openRequests },
  });

  return NextResponse.json({
    hospital: resolved.hospital,
    generatedAt: new Date(now).toISOString(),
    mode,
    note,
    metrics,
    analysis,
    auditRecorded: !auditError,
  });
}
