"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Building2, CheckCircle2, Clock3, LogOut, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PendingHospital = {
  id: string; name: string; registration_number: string | null; country: string;
  city: string | null; contact_email: string; status: string; created_at: string; created_by: string;
};

export default function PlatformApprovalsPage() {
  const router = useRouter();
  const [hospitals, setHospitals] = useState<PendingHospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rejecting, setRejecting] = useState<PendingHospital | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) { router.replace("/login"); return; }
      const response = await fetch("/api/admin/hospitals", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load hospital registrations.");
      setHospitals(payload.hospitals ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load registrations.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function decide(hospital: PendingHospital, decision: "active" | "rejected", rejectionReason = "") {
    setBusyId(hospital.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/hospitals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: hospital.id, decision, rejectionReason }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The decision could not be saved.");
      setHospitals(current => current.filter(item => item.id !== hospital.id));
      setRejecting(null); setReason("");
      setNotice(payload.warning ?? `${hospital.name} has been ${decision === "active" ? "approved" : "rejected"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be saved.");
    } finally { setBusyId(""); }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <Link href="/" className="auth-brand"><span className="auth-brand-mark"><Activity size={21} /></span><span><strong>converge</strong><small>PLATFORM ADMINISTRATION</small></span></Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="onboarding-signout" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh queue</button>
          <button className="onboarding-signout" onClick={signOut}><LogOut size={15} /> Sign out</button>
        </div>
      </header>
      <div className="onboarding-content">
        <Link href="/" className="auth-back"><ArrowLeft size={14} /> Back to workspace</Link>
        <div className="onboarding-heading"><span className="auth-overline">ACCESS GOVERNANCE</span><h1>Hospital registration review</h1><p>Verify registration details before activating a hospital workspace. Every decision is recorded in the audit trail.</p></div>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        {notice && <div className="auth-alert success" role="status"><CheckCircle2 size={17} />{notice}</div>}
        <div className="onboarding-card" style={{ marginBottom: 18 }}>
          <div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={20} /></span><div><h2>Approval controls</h2><p>Only email addresses explicitly listed in the server-side PLATFORM_ADMIN_EMAILS setting can access this queue.</p></div></div>
          <div className="approval-count"><Clock3 size={17} /> <strong>{loading ? "…" : hospitals.length}</strong> pending registration(s)</div>
        </div>
        {loading && <div className="onboarding-card">Loading pending registrations…</div>}
        {!loading && hospitals.length === 0 && !error && <div className="onboarding-card approval-empty"><CheckCircle2 size={28} /><h2>Queue is clear</h2><p>There are no pending hospital registrations to review.</p></div>}
        <div className="approval-list">
          {hospitals.map(hospital => <article className="onboarding-card approval-card" key={hospital.id}>
            <div className="approval-card-heading"><span className="onboarding-icon"><Building2 size={20} /></span><div><h2>{hospital.name}</h2><p>Submitted {new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(hospital.created_at))}</p></div><span className="approval-pending">Pending</span></div>
            <dl className="approval-details"><div><dt>Registration number</dt><dd>{hospital.registration_number || "Not supplied"}</dd></div><div><dt>Location</dt><dd>{[hospital.city, hospital.country].filter(Boolean).join(", ") || "Not supplied"}</dd></div><div><dt>Contact email</dt><dd><a href={`mailto:${hospital.contact_email}`}>{hospital.contact_email}</a></dd></div><div><dt>Registration ID</dt><dd className="approval-id">{hospital.id}</dd></div></dl>
            <div className="approval-actions"><button className="auth-submit approval-approve" disabled={!!busyId} onClick={() => void decide(hospital, "active")}>{busyId === hospital.id ? "Saving…" : <><CheckCircle2 size={16} /> Approve and activate</>}</button><button className="approval-reject" disabled={!!busyId} onClick={() => { setRejecting(hospital); setReason(""); }}><XCircle size={16} /> Reject registration</button></div>
            {rejecting?.id === hospital.id && <form className="approval-rejection" onSubmit={event => { event.preventDefault(); if (reason.trim()) void decide(hospital, "rejected", reason.trim()); }}><label>Reason for rejection<textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain what needs to be corrected before resubmission." rows={3} /></label><div><button className="approval-reject" type="button" onClick={() => setRejecting(null)}>Cancel</button><button className="auth-submit" type="submit" disabled={!reason.trim() || !!busyId}>{busyId === hospital.id ? "Saving…" : "Confirm rejection"}</button></div></form>}
          </article>)}
        </div>
        <p className="onboarding-disclaimer">This is a registration review control, not an independent regulatory verification service. Confirm official details through your organisation's approved verification process before activating access.</p>
      </div>
    </main>
  );
}
