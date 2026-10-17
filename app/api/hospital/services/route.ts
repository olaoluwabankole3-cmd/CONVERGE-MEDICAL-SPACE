import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  const requestedHospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, requestedHospitalId);
  if ("response" in resolved) return resolved.response;

  const { data, error } = await context.admin
    .from("hospital_services")
    .select("id,hospital_id,service_code,name,description,department,is_published,is_active,display_order,created_at,updated_at")
    .eq("hospital_id", resolved.hospital.id)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(300);

  if (error) return NextResponse.json({ error: "Unable to load hospital services." }, { status: 500 });
  return NextResponse.json({ hospital: resolved.hospital, role: resolved.role, services: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const serviceCode = typeof body.serviceCode === "string" ? body.serviceCode.trim().toUpperCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const department = typeof body.department === "string" ? body.department.trim() : "";

  if (!hospitalId || serviceCode.length < 2 || serviceCode.length > 80 ||
      !/^[A-Z0-9_-]+$/.test(serviceCode) || name.length < 2 || name.length > 160 ||
      description.length > 1200 || department.length > 120) {
    return NextResponse.json({ error: "Check the service code, name, department, and description." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!["owner", "admin"].includes(resolved.role)) {
    return NextResponse.json({ error: "Only hospital owners and administrators can configure published services." }, { status: 403 });
  }

  const { data, error } = await context.admin.from("hospital_services").insert({
    hospital_id: resolved.hospital.id,
    service_code: serviceCode,
    name,
    description: description || null,
    department: department || null,
    is_published: body.isPublished === true,
    is_active: body.isActive !== false,
    created_by: context.user.id,
  }).select("id,hospital_id,service_code,name,description,department,is_published,is_active,display_order,created_at,updated_at").single();

  if (error) return NextResponse.json({ error: error.message || "Unable to create this service." }, { status: 400 });
  const { error: auditError } = await context.admin.from("audit_events").insert({
    hospital_id: resolved.hospital.id,
    actor_id: context.user.id,
    entity_type: "hospital_service",
    entity_id: data.id,
    action: "hospital_service_created",
    details: { service_code: data.service_code, is_published: data.is_published },
  });

  return NextResponse.json({
    service: data,
    warning: auditError ? "The service was saved, but its audit event could not be recorded." : undefined,
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;
  if (!["owner", "admin"].includes(resolved.role)) {
    return NextResponse.json({ error: "Only hospital owners and administrators can configure services." }, { status: 403 });
  }
  if (!serviceId) return NextResponse.json({ error: "A service is required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 160) return NextResponse.json({ error: "Check the service name." }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (description.length > 1200) return NextResponse.json({ error: "The description is too long." }, { status: 400 });
    patch.description = description || null;
  }
  if (typeof body.department === "string") {
    const department = body.department.trim();
    if (department.length > 120) return NextResponse.json({ error: "The department name is too long." }, { status: 400 });
    patch.department = department || null;
  }
  if (typeof body.isPublished === "boolean") patch.is_published = body.isPublished;
  if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No service changes were supplied." }, { status: 400 });

  const { data, error } = await context.admin.from("hospital_services")
    .update(patch)
    .eq("id", serviceId)
    .eq("hospital_id", resolved.hospital.id)
    .select("id,hospital_id,service_code,name,description,department,is_published,is_active,display_order,created_at,updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message || "Unable to update this service." }, { status: 400 });
  if (!data) return NextResponse.json({ error: "The selected service was not found in this hospital." }, { status: 404 });

  const { error: auditError } = await context.admin.from("audit_events").insert({
    hospital_id: resolved.hospital.id,
    actor_id: context.user.id,
    entity_type: "hospital_service",
    entity_id: data.id,
    action: "hospital_service_updated",
    details: patch,
  });
  return NextResponse.json({
    service: data,
    warning: auditError ? "The service was updated, but its audit event could not be recorded." : undefined,
  });
}
