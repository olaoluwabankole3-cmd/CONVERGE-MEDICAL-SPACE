import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

type Severity = "urgent" | "attention" | "watch";
type Signal = {
  id: string;
  source: "request" | "appointment" | "work_item";
  severity: Severity;
  title: string;
  detail: string;
  ageLabel: string;
  href: string;
  reason: string;
  ageHours: number;
};

function hoursSince(value: string | null | undefined, now: number): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, (now - timestamp) / 3_600_000);
}

function durationLabel(hours: number): string {
  if (hours < 1) return "under 1h";
  if (hours < 24) return `${Math.floor(hours)}h waiting`;
  const days = Math.floor(hours / 24);
  const remainder = Math.floor(hours % 24);
  return remainder ? `${days}d ${remainder}h waiting` : `${days}d waiting`;
}

const terminalWorkStatuses = new Set(["resolved", "closed", "draft"]);
const terminalRequestStatuses = new Set(["completed", "no_show", "cancelled", "declined"]);

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const requestedHospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, requestedHospitalId);
  if ("response" in resolved) return resolved.response;
  const { hospital } = resolved;

  const [workResult, requestResult, appointmentResult] = await Promise.all([
    context.admin.from("work_items")
      .select("id,reference_code,title,item_type,priority,status,owner_id,due_at,patient_request_id,updated_at")
      .eq("hospital_id", hospital.id).order("updated_at", { ascending: false }).limit(200),
    context.admin.from("patient_requests")
      .select("id,request_code,status,request_type,submitted_at,updated_at")
      .eq("hospital_id", hospital.id).order("created_at", { ascending: false }).limit(200),
    context.admin.from("appointments")
      .select("id,patient_request_id,status,start_at,end_at,confirmed_at")
      .eq("hospital_id", hospital.id).order("created_at", { ascending: false }).limit(200),
  ]);

  if (workResult.error || requestResult.error || appointmentResult.error) {
    return NextResponse.json({ error: "Unable to calculate hospital coordination signals." }, { status: 500 });
  }

  const now = Date.now();
  const workItems = workResult.data ?? [];
  const requests = requestResult.data ?? [];
  const appointments = appointmentResult.data ?? [];
  const requestsById = new Map(requests.map(row => [row.id, row]));
  const appointmentsByRequest = new Map(appointments.map(row => [row.patient_request_id, row]));
  const signals: Signal[] = [];

  const activeWork = workItems.filter(row => !terminalWorkStatuses.has(row.status));
  const overdueWork = activeWork.filter(row => row.due_at && new Date(row.due_at).getTime() < now);
  const unassignedWork = activeWork.filter(row => !row.owner_id);
  const requestsNeedingAction = requests.filter(row => ["submitted", "awaiting_hospital", "cancellation_requested"].includes(row.status));
  const appointmentsAwaitingConfirmation = appointments.filter(row => row.status === "patient_accepted");

  for (const item of activeWork) {
    const ageHours = hoursSince(item.updated_at, now);
    const href = item.patient_request_id
      ? `/requests?requestId=${encodeURIComponent(item.patient_request_id)}`
      : `/work?type=${encodeURIComponent(item.item_type)}&itemId=${encodeURIComponent(item.id)}`;
    if (item.due_at && new Date(item.due_at).getTime() < now) {
      const severity: Severity = item.priority === "urgent" ? "urgent" : "attention";
      signals.push({
        id: `work-overdue-${item.id}`, source: "work_item", severity,
        title: `Overdue work · ${item.reference_code}`,
        detail: `${item.title} is past its due date${item.owner_id ? "." : " and is also unassigned."}`,
        ageLabel: durationLabel(hoursSince(item.due_at, now)), href,
        reason: item.owner_id ? "A saved deadline has passed." : "The deadline has passed and no owner is assigned.",
        ageHours: hoursSince(item.due_at, now),
      });
    } else if (!item.owner_id) {
      const severity: Severity = item.priority === "urgent" || item.priority === "high" ? "attention" : "watch";
      signals.push({
        id: `work-unassigned-${item.id}`, source: "work_item", severity,
        title: `Unassigned work · ${item.reference_code}`,
        detail: `${item.title} has no assigned owner.`,
        ageLabel: durationLabel(ageHours), href,
        reason: "Work without a named owner can stall during handovers.",
        ageHours,
      });
    } else if (["needs_review", "awaiting_response"].includes(item.status) && ageHours >= 4) {
      signals.push({
        id: `work-stalled-${item.id}`, source: "work_item",
        severity: item.priority === "urgent" ? "urgent" : "attention",
        title: `Work waiting · ${item.reference_code}`,
        detail: `${item.title} has stayed in ${item.status.replaceAll("_", " ")} for ${durationLabel(ageHours)}.`,
        ageLabel: durationLabel(ageHours), href,
        reason: "A review or response state has not changed recently.",
        ageHours,
      });
    }
  }

  for (const patientRequest of requestsNeedingAction) {
    const currentAge = hoursSince(patientRequest.updated_at ?? patientRequest.submitted_at, now);
    const severity: Severity = currentAge >= 24 ? "urgent" : currentAge >= 4 ? "attention" : "watch";
    const statusText = patientRequest.status === "submitted"
      ? "has not started hospital review"
      : patientRequest.status === "awaiting_hospital"
        ? "is waiting for a hospital response"
        : "needs a hospital cancellation decision";
    signals.push({
      id: `request-${patientRequest.id}`, source: "request",
      severity,
      title: `Request ${patientRequest.request_code} needs action`,
      detail: `This request ${statusText}.`,
      ageLabel: durationLabel(currentAge),
      href: `/requests?requestId=${encodeURIComponent(patientRequest.id)}`,
      reason: currentAge >= 24 ? "The request has remained in its current state for at least 24 hours." : "Keep the request moving and make the next step clear to the patient.",
      ageHours: currentAge,
    });
  }

  for (const appointment of appointmentsAwaitingConfirmation) {
    const patientRequest = requestsById.get(appointment.patient_request_id);
    const ageHours = hoursSince(appointment.confirmed_at, now) || hoursSince(appointment.start_at, now);
    signals.push({
      id: `appointment-${appointment.id}`, source: "appointment",
      severity: appointment.start_at && new Date(appointment.start_at).getTime() < now ? "urgent" : "attention",
      title: `Appointment confirmation${patientRequest ? ` · ${patientRequest.request_code}` : ""}`,
      detail: "The patient accepted the proposed time. Hospital confirmation is still outstanding.",
      ageLabel: appointment.start_at && new Date(appointment.start_at).getTime() < now ? "start time has passed" : durationLabel(ageHours),
      href: `/requests?requestId=${encodeURIComponent(appointment.patient_request_id)}`,
      reason: "The proposal is not a confirmed appointment until authorised staff confirm it.",
      ageHours,
    });
  }

  for (const appointment of appointments.filter(row => row.status === "reschedule_requested")) {
    const patientRequest = requestsById.get(appointment.patient_request_id);
    const ageHours = hoursSince(appointment.start_at, now);
    signals.push({
      id: `appointment-reschedule-${appointment.id}`, source: "appointment", severity: "attention",
      title: `Rescheduling request${patientRequest ? ` · ${patientRequest.request_code}` : ""}`,
      detail: "A rescheduling response needs to be coordinated with the patient.",
      ageLabel: durationLabel(ageHours),
      href: `/requests?requestId=${encodeURIComponent(appointment.patient_request_id)}`,
      reason: "Scheduling changes require a staff-reviewed response.",
      ageHours,
    });
  }

  const rank: Record<Severity, number> = { urgent: 0, attention: 1, watch: 2 };
  signals.sort((a, b) => rank[a.severity] - rank[b.severity] || b.ageHours - a.ageHours);
  const limitedSignals = signals.slice(0, 30).map(({ ageHours: _ageHours, ...signal }) => signal);

  return NextResponse.json({
    hospital: { id: hospital.id, name: hospital.name },
    summary: {
      requestsNeedingAction: requestsNeedingAction.length,
      appointmentsAwaitingConfirmation: appointmentsAwaitingConfirmation.length,
      overdueWork: overdueWork.length,
      unassignedWork: unassignedWork.length,
    },
    signals: limitedSignals,
  });
}
