import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

async function getAuthorisedAdmin() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!url || !publicKey || adminEmails.length === 0) {
    return { response: NextResponse.json({ error: "Platform administration is not configured." }, { status: 503 }) };
  }
  const sessionClient = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: values => {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
      },
    },
  });
  const { data: { user }, error } = await sessionClient.auth.getUser();
  if (error || !user?.email || !adminEmails.includes(user.email.toLowerCase())) {
    return { response: NextResponse.json({ error: "You are not authorised to access platform administration." }, { status: 403 }) };
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { response: NextResponse.json({ error: "The server-side Supabase service key is not configured." }, { status: 503 }) };
  const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { user, adminClient };
}

export async function GET() {
  const auth = await getAuthorisedAdmin();
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.adminClient
    .from("hospitals")
    .select("id,name,registration_number,country,city,contact_email,status,created_at,created_by")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: "Unable to load pending registrations." }, { status: 500 });
  return NextResponse.json({ hospitals: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthorisedAdmin();
  if ("response" in auth) return auth.response;
  let body: { hospitalId?: unknown; decision?: unknown; rejectionReason?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const decision = body.decision;
  const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim().slice(0, 1000) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId) || !["active", "rejected"].includes(String(decision))) {
    return NextResponse.json({ error: "A valid hospital and approval decision are required." }, { status: 400 });
  }
  if (decision === "rejected" && !rejectionReason) {
    return NextResponse.json({ error: "Provide a reason when rejecting a registration." }, { status: 400 });
  }
  const { data: hospital, error: decisionError } = await auth.adminClient.rpc(
    "decide_hospital_registration",
    {
      p_hospital_id: hospitalId,
      p_actor_user_id: auth.user.id,
      p_decision: decision,
      p_rejection_reason: decision === "rejected" ? rejectionReason : null,
    },
  );

  if (decisionError) {
    return NextResponse.json(
      { error: "Unable to save the decision and audit event. Confirm the latest hospital-approval migration has been applied." },
      { status: 500 },
    );
  }
  if (!hospital) {
    return NextResponse.json(
      { error: "This registration is no longer pending. Refresh the queue." },
      { status: 409 },
    );
  }

  return NextResponse.json({ hospital });
}
