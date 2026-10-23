import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const allowedRoles = ["admin", "clinician", "operations", "reviewer"] as const;
type InviteRole = (typeof allowedRoles)[number];

async function getClients() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !serviceKey) {
    return { response: NextResponse.json({ error: "Team administration is not configured on the server." }, { status: 503 }) };
  }
  const session = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: values => {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
      },
    },
  });
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Sign in to manage your hospital team." }, { status: 401 }) };
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { user, admin, session };
}

export async function GET(request: NextRequest) {
  const clients = await getClients();
  if ("response" in clients) return clients.response;
  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)) {
    return NextResponse.json({ error: "A valid hospital workspace is required." }, { status: 400 });
  }
  const { data: membership, error: membershipError } = await clients.admin
    .from("hospital_memberships").select("role").eq("hospital_id", hospitalId).eq("user_id", clients.user.id).maybeSingle();
  if (membershipError) return NextResponse.json({ error: "Unable to verify hospital permissions." }, { status: 500 });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only hospital owners and administrators can manage team membership." }, { status: 403 });
  }
  const { data: hospital, error: hospitalError } = await clients.admin
    .from("hospitals").select("id,status").eq("id", hospitalId).maybeSingle();
  if (hospitalError) return NextResponse.json({ error: "Unable to verify hospital status." }, { status: 500 });
  if (!hospital || hospital.status !== "active") return NextResponse.json({ error: "Team management is available only after the hospital is activated." }, { status: 409 });
  const { data: members, error } = await clients.admin
    .from("hospital_memberships").select("id,user_id,role,created_at").eq("hospital_id", hospitalId).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Unable to load hospital team." }, { status: 500 });
  const ids = (members ?? []).map(member => member.user_id);
  const emailById = new Map<string, string>();
  for (const id of ids) {
    const { data } = await clients.admin.auth.admin.getUserById(id);
    if (data.user) emailById.set(id, data.user.email ?? "");
  }
  return NextResponse.json({ members: (members ?? []).map(member => ({
    id: member.id, user_id: member.user_id, role: member.role, created_at: member.created_at,
    email: emailById.get(member.user_id) ?? "",
  })) });
}

export async function POST(request: NextRequest) {
  const clients = await getClients();
  if ("response" in clients) return clients.response;
  let body: { hospitalId?: unknown; email?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowedRoles.includes(role as InviteRole)) {
    return NextResponse.json({ error: "Provide a valid hospital, email address, and supported role." }, { status: 400 });
  }
  const { data: actorMembership, error: actorError } = await clients.admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", clients.user.id).maybeSingle();
  if (actorError) return NextResponse.json({ error: "Unable to verify your hospital role." }, { status: 500 });
  if (!actorMembership || !["owner", "admin"].includes(actorMembership.role)) {
    return NextResponse.json({ error: "Only hospital owners and administrators can invite team members." }, { status: 403 });
  }
  if (role === "admin" && actorMembership.role !== "owner") {
    return NextResponse.json({ error: "Only a hospital owner can invite another administrator." }, { status: 403 });
  }
  const { data: hospital, error: hospitalError } = await clients.admin.from("hospitals")
    .select("id,name,status").eq("id", hospitalId).maybeSingle();
  if (hospitalError) return NextResponse.json({ error: "Unable to verify hospital status." }, { status: 500 });
  if (!hospital || hospital.status !== "active") return NextResponse.json({ error: "The hospital must be active before team invitations can be sent." }, { status: 409 });

  const { data: userPage, error: usersError } = await clients.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return NextResponse.json({ error: "Unable to verify whether this email already has an account." }, { status: 500 });
  const existing = userPage.users.find(user => user.email?.toLowerCase() === email);
  const existingIsConfirmed = Boolean(existing?.email_confirmed_at || existing?.confirmed_at);
  let invitedUserId = existing?.id;
  let invitationSent = false;

  // A confirmed account should use its existing credentials. An unconfirmed
  // account may be left behind when a previous invite email failed; retry the
  // invitation instead of silently adding membership without notifying them.
  if (!existing || !existingIsConfirmed) {
    const { data: invite, error: inviteError } = await clients.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: new URL("/auth/confirm?next=/accept-invite", request.nextUrl.origin).toString(),
      data: { invited_hospital_id: hospitalId, invited_hospital_name: hospital.name },
    });
    if (inviteError || !invite.user) {
      return NextResponse.json({
        error: `Could not send the invitation email. ${inviteError?.message ?? "Supabase did not return an invited account."} Check the Supabase Auth SMTP configuration and email logs before retrying.`,
      }, { status: 502 });
    }
    invitedUserId = invite.user.id;
    invitationSent = true;
  }

  if (!invitedUserId) return NextResponse.json({ error: "The invited account could not be identified." }, { status: 502 });

  const { data: existingMembership, error: lookupError } = await clients.admin.from("hospital_memberships")
    .select("id,role").eq("hospital_id", hospitalId).eq("user_id", invitedUserId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "The invitation was prepared, but hospital membership could not be checked." }, { status: 500 });

  if (existingMembership) {
    if (invitationSent) {
      const { error: auditError } = await clients.admin.from("audit_events").insert({
        hospital_id: hospitalId, actor_id: clients.user.id, entity_type: "hospital_membership",
        entity_id: invitedUserId, action: "team_invitation_resent", details: { email, role: existingMembership.role },
      });
      return NextResponse.json({
        member: { user_id: invitedUserId, email, role: existingMembership.role },
        message: "A new invitation email was sent for this pending account. Its existing hospital role has been preserved.",
        warning: auditError ? "The invitation was sent, but the audit event could not be recorded." : undefined,
      }, { status: 200 });
    }
    return NextResponse.json({ error: "This user is already a member of this hospital." }, { status: 409 });
  }

  const { error: insertError } = await clients.admin.from("hospital_memberships").insert({
    hospital_id: hospitalId, user_id: invitedUserId, role,
  });
  if (insertError) return NextResponse.json({ error: "The account was identified, but hospital membership could not be added." }, { status: 500 });

  const { error: auditError } = await clients.admin.from("audit_events").insert({
    hospital_id: hospitalId, actor_id: clients.user.id, entity_type: "hospital_membership",
    entity_id: invitedUserId, action: invitationSent ? "team_member_invited" : "team_member_added",
    details: { email, role, invitation_sent: invitationSent },
  });
  const message = invitationSent
    ? "Invitation email sent through Supabase Auth. The worker must open it and set their password."
    : "Existing account added to this hospital workspace. No invitation email was sent; the worker should sign in with their existing password or use Forgot password.";
  return NextResponse.json({
    member: { user_id: invitedUserId, email, role }, message,
    warning: auditError ? "Membership was added, but the audit event could not be recorded." : undefined,
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const clients = await getClients();
  if ("response" in clients) return clients.response;
  let body: { hospitalId?: unknown; userId?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  const nextRole = typeof body.role === "string" ? body.role : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)
      || !allowedRoles.includes(nextRole as InviteRole)) {
    return NextResponse.json({ error: "Provide a valid hospital, member, and supported role." }, { status: 400 });
  }
  if (targetUserId === clients.user.id) return NextResponse.json({ error: "You cannot change your own role here." }, { status: 409 });
  const { data: actor, error: actorError } = await clients.admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", clients.user.id).maybeSingle();
  if (actorError) return NextResponse.json({ error: "Unable to verify your hospital role." }, { status: 500 });
  if (!actor || !["owner", "admin"].includes(actor.role)) return NextResponse.json({ error: "Hospital administrator permission is required." }, { status: 403 });
  if (nextRole === "admin" && actor.role !== "owner") return NextResponse.json({ error: "Only the hospital owner can assign administrator access." }, { status: 403 });
  const { data: target, error: targetError } = await clients.admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", targetUserId).maybeSingle();
  if (targetError) return NextResponse.json({ error: "Unable to verify the selected member." }, { status: 500 });
  if (!target) return NextResponse.json({ error: "That user is not a member of this hospital." }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "The hospital owner role cannot be changed here." }, { status: 409 });
  if (actor.role !== "owner" && target.role === "admin") return NextResponse.json({ error: "Administrators cannot change another administrator's role." }, { status: 403 });
  const { error: updateError } = await clients.admin.from("hospital_memberships")
    .update({ role: nextRole }).eq("hospital_id", hospitalId).eq("user_id", targetUserId);
  if (updateError) return NextResponse.json({ error: "Unable to update this member's role." }, { status: 500 });
  const { error: auditError } = await clients.admin.from("audit_events").insert({
    hospital_id: hospitalId, actor_id: clients.user.id, entity_type: "hospital_membership",
    entity_id: targetUserId, action: "team_member_role_changed", details: { previous_role: target.role, role: nextRole },
  });
  return NextResponse.json({ success: true, warning: auditError ? "Role updated, but the audit event could not be recorded." : undefined });
}

export async function DELETE(request: NextRequest) {
  const clients = await getClients();
  if ("response" in clients) return clients.response;
  const hospitalId = request.nextUrl.searchParams.get("hospitalId") ?? "";
  const targetUserId = request.nextUrl.searchParams.get("userId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hospitalId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return NextResponse.json({ error: "A valid hospital and member are required." }, { status: 400 });
  }
  if (targetUserId === clients.user.id) return NextResponse.json({ error: "You cannot remove your own membership here." }, { status: 409 });
  const { data: actor, error: actorError } = await clients.admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", clients.user.id).maybeSingle();
  if (actorError) return NextResponse.json({ error: "Unable to verify your hospital role." }, { status: 500 });
  if (!actor || !["owner", "admin"].includes(actor.role)) return NextResponse.json({ error: "Hospital administrator permission is required." }, { status: 403 });
  const { data: target, error: targetError } = await clients.admin.from("hospital_memberships")
    .select("role").eq("hospital_id", hospitalId).eq("user_id", targetUserId).maybeSingle();
  if (targetError) return NextResponse.json({ error: "Unable to verify the selected member." }, { status: 500 });
  if (!target) return NextResponse.json({ error: "That user is not a member of this hospital." }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "The hospital owner cannot be removed from the team here." }, { status: 409 });
  if (actor.role !== "owner" && target.role === "admin") return NextResponse.json({ error: "Administrators cannot remove another administrator." }, { status: 403 });
  const { error: deleteError } = await clients.admin.from("hospital_memberships")
    .delete().eq("hospital_id", hospitalId).eq("user_id", targetUserId);
  if (deleteError) return NextResponse.json({ error: "Unable to remove this member." }, { status: 500 });
  const { error: auditError } = await clients.admin.from("audit_events").insert({
    hospital_id: hospitalId, actor_id: clients.user.id, entity_type: "hospital_membership",
    entity_id: targetUserId, action: "team_member_removed", details: { previous_role: target.role },
  });
  return NextResponse.json({ success: true, warning: auditError ? "Member removed, but the audit event could not be recorded." : undefined });
}
