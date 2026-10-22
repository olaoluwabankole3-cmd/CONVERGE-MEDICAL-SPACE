"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Building2, CheckCircle2, LoaderCircle, MailPlus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Member = { id?: string; user_id: string; email: string; role: string; created_at?: string };
type Hospital = { id: string; name: string; status: string };

const roles = [
  { value: "operations", label: "Operations", description: "Coordinate operational work items." },
  { value: "clinician", label: "Clinician", description: "Create and update permitted operational work." },
  { value: "reviewer", label: "Reviewer", description: "Review and update records within the workspace." },
  { value: "admin", label: "Administrator", description: "Manage team membership and hospital operations." },
];

export default function HospitalTeamPage() {
  const router = useRouter();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [role, setRole] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("operations");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) { router.replace("/login"); return; }
      const { data: memberships, error: membershipError } = await supabase.from("hospital_memberships")
        .select("hospital_id,role,created_at").order("created_at", { ascending: false }).limit(1);
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) throw new Error("No active hospital membership was found for this account.");
      const { data: hospitalData, error: hospitalError } = await supabase.from("hospitals")
        .select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
      if (hospitalError) throw hospitalError;
      if (!hospitalData) throw new Error("The hospital workspace could not be found.");
      setHospital(hospitalData as Hospital); setRole(membership.role);
      if (hospitalData.status !== "active") {
        setMembers([]);
        return;
      }
      if (!["owner", "admin"].includes(membership.role)) {
        setMembers([]);
        return;
      }
      const response = await fetch(`/api/hospital/team?hospitalId=${encodeURIComponent(hospitalData.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load team members.");
      setMembers(payload.members ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the hospital team.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hospital) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: hospital.id, email: email.trim(), role: inviteRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The invitation could not be sent.");
      setNotice(payload.warning ?? payload.message ?? `Team access updated for ${email.trim()}.`);
      setEmail("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be sent.");
    } finally { setSaving(false); }
  }

  async function changeMemberRole(member: Member, nextRole: string) {
    if (!hospital || !member.user_id || member.role === "owner" || nextRole === member.role) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/team", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: hospital.id, userId: member.user_id, role: nextRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not update the member role.");
      setNotice(payload.warning ?? `${member.email || "Team member"}'s role was updated to ${nextRole}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the member role.");
      await load();
    } finally { setSaving(false); }
  }

  async function removeMember(member: Member) {
    if (!hospital || !member.user_id || member.role === "owner") return;
    if (!window.confirm(`Remove ${member.email || "this member"} from ${hospital.name}? Their account will remain, but this hospital membership will be revoked.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const params = new URLSearchParams({ hospitalId: hospital.id, userId: member.user_id });
      const response = await fetch(`/api/hospital/team?${params.toString()}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not remove this member.");
      setNotice(payload.warning ?? `${member.email || "Team member"} was removed from this hospital.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this member.");
    } finally { setSaving(false); }
  }

  const canManage = ["owner", "admin"].includes(role);
  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <Link href="/" className="auth-brand"><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo auth-converge-logo" /></Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="onboarding-signout" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <Link className="onboarding-signout" href="/"><ArrowLeft size={15} /> Workspace</Link>
        </div>
      </header>
      <div className="onboarding-content">
        <div className="onboarding-heading"><span className="auth-overline">HOSPITAL GOVERNANCE</span><h1>Team and access</h1><p>Manage who belongs to this hospital workspace and the role they use to access operational records.</p></div>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        {notice && <div className="auth-alert success" role="status"><CheckCircle2 size={17} /> {notice}</div>}
        {loading && <div className="onboarding-card"><LoaderCircle size={18} /> Loading hospital access…</div>}
        {!loading && hospital && hospital.status !== "active" && <section className="onboarding-card"><div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={20} /></span><div><h2>Workspace not active</h2><p>Team administration becomes available after an authorised platform administrator approves {hospital.name}.</p></div></div></section>}
        {!loading && hospital?.status === "active" && !canManage && <section className="onboarding-card"><div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={20} /></span><div><h2>Administrator permission required</h2><p>Your current role is {role}. Ask the hospital owner or an administrator to manage team access.</p></div></div></section>}
        {!loading && hospital?.status === "active" && canManage && <>
          <section className="onboarding-card" style={{ marginBottom: 18 }}>
            <div className="onboarding-card-title"><span className="onboarding-icon"><Building2 size={20} /></span><div><h2>{hospital.name}</h2><p>Hospital workspace · {members.length} current member(s)</p></div><span className="approval-pending" style={{ color: "#bfeecb", background: "rgba(164,237,193,.10)", border: "1px solid rgba(164,237,193,.18)" }}>Active</span></div>
          </section>
          <div className="onboarding-grid">
            <section className="onboarding-card">
              <div className="onboarding-card-title"><span className="onboarding-icon"><MailPlus size={20} /></span><div><h2>Invite a team member</h2><p>An invitation is sent through Supabase Auth. The user must accept it to sign in.</p></div></div>
              <form className="onboarding-form" onSubmit={invite}>
                <label>Work email address<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="colleague@hospital.org" /></label>
                <label>Workspace role<select value={inviteRole} onChange={event => setInviteRole(event.target.value)}>{roles.filter(item => item.value !== "admin" || role === "owner").map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <div className="form-note"><ShieldCheck size={16} /> Invitations grant access only to this hospital. Only an owner can invite another administrator.</div>
                <button className="auth-submit" type="submit" disabled={saving}>{saving ? "Preparing invitation…" : "Invite team member"} <ArrowRight size={16} /></button>
              </form>
            </section>
            <section className="onboarding-card">
              <div className="onboarding-card-title"><span className="onboarding-icon"><Users size={20} /></span><div><h2>Current members</h2><p>Accounts with a membership in this workspace.</p></div></div>
              <div style={{ display: "grid", gap: 0 }}>
                {members.map(member => <div key={member.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: "1px solid var(--line, #e5ebef)" }}>
                  <span className="onboarding-icon" style={{ width: 36, height: 36, flexShrink: 0 }}><Users size={16} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", overflowWrap: "anywhere", fontSize: 13 }}>{member.email || "Invited account"}</strong><span style={{ color: "var(--muted, #72818d)", fontSize: 12 }}>{member.role.replaceAll("_", " ")}{member.created_at ? ` · Added ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(member.created_at))}` : ""}</span></div>
                  {member.role === "owner" ? <span className="approval-pending">Owner</span> : <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <select aria-label={`Role for ${member.email || "team member"}`} value={member.role} disabled={saving || (role !== "owner" && member.role === "admin")} onChange={event => void changeMemberRole(member, event.target.value)} style={{ border: "1px solid var(--line, #e5ebef)", borderRadius: 7, padding: "7px 8px", maxWidth: 135, background: "#0d1511", color: "#f3f5f3", fontSize: 12 }}>
                      {roles.filter(item => item.value !== "admin" || role === "owner" || member.role === "admin").map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <button type="button" className="approval-reject" disabled={saving || (role !== "owner" && member.role === "admin")} onClick={() => void removeMember(member)} style={{ padding: "7px 9px", fontSize: 11 }}>Remove</button>
                  </div>}
                </div>)}
                {members.length === 0 && <p style={{ color: "var(--muted, #72818d)", fontSize: 13 }}>No memberships are visible yet.</p>}
              </div>
            </section>
          </div>
          <section className="onboarding-card" style={{ marginTop: 18 }}>
            <div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={20} /></span><div><h2>Role boundaries</h2><p>Keep access aligned with each person’s responsibilities.</p></div></div>
            <div className="approval-details">
              {roles.map(item => <div key={item.value}><dt>{item.label}</dt><dd>{item.description}{item.value === "admin" ? " Only an owner can assign this role through invitations." : ""}</dd></div>)}
              <div><dt>Owner</dt><dd>Primary hospital account holder. Owner role assignment is not available through the invitation form.</dd></div>
            </div>
          </section>
        </>}
        <p className="onboarding-disclaimer">Invitees should receive only the minimum access needed for their work. Use synthetic records during development; verify role permissions and invitation email delivery before production use.</p>
      </div>
    </main>
  );
}
