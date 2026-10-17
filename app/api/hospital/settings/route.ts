import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

async function context() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !serviceKey) return { response: NextResponse.json({ error: "Hospital settings are not configured on the server." }, { status: 503 }) };
  const session = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: values => { try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {} },
    },
  });
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Sign in to manage hospital settings." }, { status: 401 }) };
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { user, admin };
}

async function authorised(hospitalId: string, userId: string, admin: ReturnType<typeof createClient>) {
  const { data: membership, error: membershipError } = await admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", userId).maybeSingle();
  if (membershipError) return { error: NextResponse.json({ error: "Unable to verify hospital permissions." }, { status: 500 }) };
  if (!membership || !["owner", "admin"].includes(membership.role)) return { error: NextResponse.json({ error: "Only hospital owners and administrators can update hospital settings." }, { status: 403 }) };
  const { data: hospital, error } = await admin.from("hospitals")
    .select("id,name,registration_number,country,city,contact_email,status,created_at,updated_at")
    .eq("id", hospitalId).maybeSingle();
  if (error) return { error: NextResponse.json({ error: "Unable to load hospital settings." }, { status: 500 }) };
  if (!hospital) return { error: NextResponse.json({ error: "Hospital workspace not found." }, { status: 404 }) };
  return { hospital, role: membership.role };
}

export async function GET(request: NextRequest) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)) return NextResponse.json({ error: "A valid hospital workspace is required." }, { status: 400 });
  const result = await authorised(hospitalId, ctx.user.id, ctx.admin);
  if ("error" in result) return result.error;
  return NextResponse.json({ hospital: result.hospital, role: result.role });
}

export async function PATCH(request: NextRequest) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)) return NextResponse.json({ error: "A valid hospital workspace is required." }, { status: 400 });
  const result = await authorised(hospitalId, ctx.user.id, ctx.admin);
  if ("error" in result) return result.error;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const contactEmail = typeof body.contact_email === "string" ? body.contact_email.trim().toLowerCase() : "";
  const registrationNumber = typeof body.registration_number === "string" ? body.registration_number.trim() : "";
  if (name.length < 2 || name.length > 180 || !country || country.length > 100 || city.length > 120
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) || registrationNumber.length > 120) {
    return NextResponse.json({ error: "Check the hospital name, country, contact email, and field lengths." }, { status: 400 });
  }
  if (result.hospital.status !== "active") return NextResponse.json({ error: "Hospital settings can be changed after activation. Pending registration corrections should be handled through the platform administrator." }, { status: 409 });
  const { data: updated, error: updateError } = await ctx.admin.from("hospitals")
    .update({ name, country, city: city || null, contact_email: contactEmail, registration_number: registrationNumber || null })
    .eq("id", hospitalId).select("id,name,registration_number,country,city,contact_email,status,created_at,updated_at").single();
  if (updateError) return NextResponse.json({ error: "Unable to save hospital settings." }, { status: 500 });
  const { error: auditError } = await ctx.admin.from("audit_events").insert({
    hospital_id: hospitalId, actor_id: ctx.user.id, entity_type: "hospital", entity_id: hospitalId,
    action: "hospital_settings_updated", details: { name, country, city, contact_email: contactEmail, registration_number: registrationNumber || null },
  });
  return NextResponse.json({ hospital: updated, warning: auditError ? "Settings were saved, but the audit event could not be recorded." : undefined });
}
