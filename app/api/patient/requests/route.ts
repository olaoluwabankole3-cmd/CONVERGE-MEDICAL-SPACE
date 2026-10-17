import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";

const requestTypes = new Set(["appointment", "service_request", "follow_up"]);

function asIsoDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function GET() {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  const { user, admin } = context;

  const [{ data: profile, error: profileError }, { data: requests, error: requestsError }] = await Promise.all([
    admin.from("patient_profiles").select("user_id,display_name,phone_number,phone_verified_at")
      .eq("user_id", user.id).maybeSingle(),
    admin.from("patient_requests")
      .select("id,request_code,hospital_id,service_id,request_type,status,subject,preferred_start_at,preferred_end_at,submitted_at,created_at,updated_at,closed_at")
      .eq("patient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (profileError || requestsError) {
    return NextResponse.json({ error: "Unable to load your patient workspace." }, { status: 500 });
  }

  const rows = requests ?? [];
  const requestIds = rows.map(row => row.id);
  const serviceIds = [...new Set(rows.map(row => row.service_id).filter(Boolean))] as string[];
  const hospitalIds = [...new Set(rows.map(row => row.hospital_id))];

  const [appointmentResult, messageResult, serviceResult, hospitalResult] = await Promise.all([
    requestIds.length
      ? admin.from("appointments").select("id,patient_request_id,status,start_at,end_at,location,patient_instructions,confirmed_at")
          .in("patient_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? admin.from("request_messages").select("id,patient_request_id,author_type,body,created_at")
          .in("patient_request_id", requestIds).eq("visibility", "patient_visible").order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    serviceIds.length
      ? admin.from("hospital_services").select("id,name,department").in("id", serviceIds)
      : Promise.resolve({ data: [], error: null }),
    hospitalIds.length
      ? admin.from("hospitals").select("id,name,city,country").in("id", hospitalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (appointmentResult.error || messageResult.error || serviceResult.error || hospitalResult.error) {
    return NextResponse.json({ error: "Unable to load request details." }, { status: 500 });
  }

  const appointmentByRequest = new Map((appointmentResult.data ?? []).map(item => [item.patient_request_id, item]));
  const messagesByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const message of messageResult.data ?? []) {
    const list = messagesByRequest.get(message.patient_request_id) ?? [];
    list.push(message);
    messagesByRequest.set(message.patient_request_id, list);
  }
  const serviceById = new Map((serviceResult.data ?? []).map(item => [item.id, item]));
  const hospitalById = new Map((hospitalResult.data ?? []).map(item => [item.id, item]));

  return NextResponse.json({
    profile: profile ?? {
      user_id: user.id,
      display_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      phone_number: "",
      phone_verified_at: null,
    },
    email: user.email ?? "",
    requests: rows.map(row => ({
      ...row,
      service: serviceById.get(row.service_id) ?? null,
      hospital: hospitalById.get(row.hospital_id) ?? null,
      appointment: appointmentByRequest.get(row.id) ?? null,
      messages: messagesByRequest.get(row.id) ?? [],
    })),
  });
}

export async function POST(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  const { user, admin } = context;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const type = typeof body.requestType === "string" ? body.requestType : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const preferredStartAt = asIsoDate(body.preferredStartAt);
  const preferredEndAt = asIsoDate(body.preferredEndAt);

  if (!hospitalId || !serviceId || !requestTypes.has(type)) {
    return NextResponse.json({ error: "Choose a hospital, service, and request type." }, { status: 400 });
  }
  if (subject.length < 3 || subject.length > 160) {
    return NextResponse.json({ error: "The request subject must be between 3 and 160 characters." }, { status: 400 });
  }
  if (displayName.length < 2 || displayName.length > 160) {
    return NextResponse.json({ error: "Enter your name to continue." }, { status: 400 });
  }
  if (phoneNumber && (phoneNumber.length < 7 || phoneNumber.length > 32)) {
    return NextResponse.json({ error: "Check the phone number or leave it blank." }, { status: 400 });
  }
  if (message.length > 3000) {
    return NextResponse.json({ error: "Your message must be no longer than 3000 characters." }, { status: 400 });
  }
  if (preferredStartAt === undefined || preferredEndAt === undefined) {
    return NextResponse.json({ error: "Enter valid preferred appointment dates." }, { status: 400 });
  }
  if (type === "appointment" && preferredStartAt && preferredEndAt && preferredEndAt <= preferredStartAt) {
    return NextResponse.json({ error: "The preferred end time must be after the start time." }, { status: 400 });
  }
  if (type !== "appointment" && (preferredStartAt || preferredEndAt)) {
    return NextResponse.json({ error: "Preferred times are only used for appointment requests." }, { status: 400 });
  }

  const { data, error } = await admin.rpc("submit_patient_request", {
    p_patient_user_id: user.id,
    p_hospital_id: hospitalId,
    p_service_id: serviceId,
    p_request_type: type,
    p_subject: subject,
    p_message: message || null,
    p_preferred_start_at: preferredStartAt,
    p_preferred_end_at: preferredEndAt,
    p_display_name: displayName,
    p_phone_number: phoneNumber || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Unable to submit your request." }, { status: 400 });
  }
  return NextResponse.json({ request: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  const { user, admin } = context;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!requestId || !["accept_appointment", "send_message", "cancel_request"].includes(action)) {
    return NextResponse.json({ error: "Choose a valid request action." }, { status: 400 });
  }
  if (action === "send_message" && (!message || message.length > 3000)) {
    return NextResponse.json({ error: "Enter a message of up to 3000 characters." }, { status: 400 });
  }

  const { data, error } = await admin.rpc("patient_respond_to_request", {
    p_patient_user_id: user.id,
    p_patient_request_id: requestId,
    p_action: action,
    p_message: message || null,
  });
  if (error) {
    return NextResponse.json({ error: error.message || "Unable to update this request." }, { status: 400 });
  }
  return NextResponse.json({ result: data });
}
