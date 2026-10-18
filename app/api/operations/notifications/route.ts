import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAdminContext } from "@/lib/server/supabase-admin";
import { resolveActiveHospital } from "@/lib/server/hospital-context";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedAdminContext();
  if ("response" in context) return context.response;

  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? undefined;
  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;

  const [notificationsResult, unreadResult] = await Promise.all([
    context.admin.from("user_notifications")
      .select("id,hospital_id,recipient_user_id,notification_type,title,body,action_url,entity_type,entity_id,created_at,read_at")
      .eq("hospital_id", resolved.hospital.id)
      .eq("recipient_user_id", context.user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    context.admin.from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", resolved.hospital.id)
      .eq("recipient_user_id", context.user.id)
      .is("read_at", null),
  ]);

  if (notificationsResult.error || unreadResult.error) {
    return NextResponse.json({ error: "Unable to load your hospital notifications. Confirm the notifications migration has been applied." }, { status: 500 });
  }

  return NextResponse.json({
    hospital: resolved.hospital,
    notifications: notificationsResult.data ?? [],
    unreadCount: unreadResult.count ?? 0,
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
  const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
  const markAllRead = body.markAllRead === true;

  if (!UUID_PATTERN.test(hospitalId) || (!markAllRead && !UUID_PATTERN.test(notificationId))) {
    return NextResponse.json({ error: "Provide a valid hospital and notification." }, { status: 400 });
  }

  const resolved = await resolveActiveHospital(context.admin, context.user.id, hospitalId);
  if ("response" in resolved) return resolved.response;

  if (markAllRead) {
    const { data, error } = await context.admin.from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("hospital_id", resolved.hospital.id)
      .eq("recipient_user_id", context.user.id)
      .is("read_at", null)
      .select("id");

    if (error) return NextResponse.json({ error: "Unable to mark your notifications as read." }, { status: 500 });
    return NextResponse.json({ markedRead: data?.length ?? 0 });
  }

  const { data, error } = await context.admin.from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("hospital_id", resolved.hospital.id)
    .eq("recipient_user_id", context.user.id)
    .is("read_at", null)
    .select("id,read_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Unable to update this notification." }, { status: 500 });
  if (!data) {
    const { data: existing, error: lookupError } = await context.admin.from("user_notifications")
      .select("id,read_at")
      .eq("id", notificationId)
      .eq("hospital_id", resolved.hospital.id)
      .eq("recipient_user_id", context.user.id)
      .maybeSingle();
    if (lookupError) return NextResponse.json({ error: "Unable to verify this notification." }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ notification: existing, alreadyRead: true });
  }

  return NextResponse.json({ notification: data });
}
