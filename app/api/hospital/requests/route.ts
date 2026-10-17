import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

function isoDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  const requestedHospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, requestedHospitalId);
  if ("response" in resolved) return resolved.response;

  const { hospital, role } = resolved;
  const { data: rows, error } = await context.admin
    .from("patient_requests")
    .select("id,request_code,hospital_id,patient_user_id,patient_record_id,service_id,request_type,status,subject,preferred_start_at,preferred_end_at,submitted_at,created_at,updated_at,closed_at")
    .eq("hospital_id", hospital.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: "Unable to load hospital requests." }, { status: 500 });
  const requests = rows ?? [];
  const requestIds = requests.map(row => row.id);
  const patientIds = [...new Set(requests.map(row => row.patient_user_id))];
  const serviceIds = [...new Set(requests.map(row => row.service_id).filter(Boolean))] as string[];

  const [profiles, services, appointments, messages] = await Promise.all([
    patientIds.length
      ? context.admin.from("patient_profiles").select("user_id,display_name,phone_number").in("user_id", patientIds)
      : Promise.resolve({ data: [], error: null }),
    serviceIds.length
      ? context.admin.from("hospital_services").select("id,name,department").in("id", serviceIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? context.admin.from("appointments").select("id,patient_request_id,status,start_at,end_at,location,patient_instructions,confirmed_at")
          .in("patient_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? context.admin.from("request_messages").select("id,patient_request_id,author_user_id,author_type,visibility,body,created_at")
          .in("patient_request_id", requestIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profiles.error || services.error || appointments.error || messages.error) {
    return NextResponse.json({ error: "Unable to load request details." }, { status: 500 });
  }

  const profileById = new Map((profiles.data ?? []).map(item => [item.user_id, item]));
  const serviceById = new Map((services.data ?? []).map(item => [item.id, item]));
  const appointmentByRequest = new Map((appointments.data ?? []).map(item => [item.patient_request_id, item]));
  const messagesByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const message of messages.data ?? []) {
    const list = messagesByRequest.get(message.patient_request_id) ?? [];
    list.push(message);
    messagesByRequest.set(message.patient_request_id, list);
  }

  return NextResponse.json({
    hospital,
    role,
    requests: requests.map(row => ({
      ...row,
      patient: profileById.get(row.patient_user_id) ?? { display_name: "Patient", phone_number: null },
      service: serviceById.get(row.service_id) ?? null,
      appointment: appointmentByRequest.get(row.id) ?? null,
      messages: messagesByRequest.get(row.id) ?? [],
    })),
  });
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
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const startAt = isoDate(body.startAt);
  const endAt = isoDate(body.endAt);
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";

  const actions = new Set([
    "start_review", "ask_patient", "propose_appointment", "confirm_appointment",
    "decline_request", "complete_request", "approve_cancellation", "reject_cancellation",
  ]);
  if (!hospitalId || !requestId || !actions.has(action)) {
    return NextResponse.json({ error: "Choose a valid request action and hospital." }, { status: 400 });
  }
  if (startAt === undefined || endAt === undefined) {
    return NextResponse.json({ error: "Enter a valid appointment time." }, { status: 400 });
  }
  if (action === "propose_appointment") {
    if (!startAt || !endAt || endAt <= startAt) {
      return NextResponse.json({ error: "A valid appointment start and end time are required." }, { status: 400 });
    }
    if (location.length > 240 || instructions.length > 1200) {
      return NextResponse.json({ error: "Check the location and instruction lengths." }, { status: 400 });
    }
  }
  if (["ask_patient"].includes(action) && (!message || message.length > 3000)) {
    return NextResponse.json({ error: "Enter a patient-visible message of up to 3000 characters." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!["owner", "admin", "clinician", "operations"].includes(resolved.role)) {
    return NextResponse.json({ error: "Your hospital role is read-only for request actions." }, { status: 403 });
  }

  const { data, error } = await context.admin.rpc("staff_handle_patient_request", {
    p_actor_user_id: context.user.id,
    p_hospital_id: resolved.hospital.id,
    p_patient_request_id: requestId,
    p_action: action,
    p_message: message || null,
    p_start_at: startAt,
    p_end_at: endAt,
    p_location: location || null,
    p_instructions: instructions || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Unable to complete this request action." }, { status: 400 });
  }
  return NextResponse.json({ result: data });
}
