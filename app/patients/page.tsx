"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Archive, CheckCircle2, Plus, RefreshCw, Search, ShieldCheck, UserRound } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PatientStatus = "active" | "archived";
type PatientRecord = { id: string; hospital_id: string; reference_code: string; external_reference: string | null; care_area: string | null; status: PatientStatus; created_by: string; created_at: string; updated_at: string };

export default function PatientReferencesPage() {
  const router = useRouter();
  const [hospitalId, setHospitalId] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [selected, setSelected] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PatientStatus>("active");
  const [reference, setReference] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [careArea, setCareArea] = useState("");
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
        .select("hospital_id,created_at").order("created_at", { ascending: false }).limit(1);
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) throw new Error("No active hospital membership was found.");
      const { data: hospital, error: hospitalError } = await supabase.from("hospitals")
        .select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
      if (hospitalError) throw hospitalError;
      if (!hospital || hospital.status !== "active") throw new Error("Patient references are available after hospital activation.");
      const { data, error: recordsError } = await supabase.from("patient_records")
        .select("id,hospital_id,reference_code,external_reference,care_area,status,created_by,created_at,updated_at")
        .eq("hospital_id", hospital.id).order("updated_at", { ascending: false }).limit(500);
      if (recordsError) throw recordsError;
      setHospitalId(hospital.id); setHospitalName(hospital.name); setRecords((data ?? []) as PatientRecord[]);
      setSelected(current => current ? ((data ?? []) as PatientRecord[]).find(item => item.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load patient references.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => records.filter(record =>
    (filter === "all" || record.status === filter) &&
    [record.reference_code, record.external_reference ?? "", record.care_area ?? ""].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))
  ), [records, filter, search]);

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hospitalId) return;
    setSaving(true); setError(""); setNotice("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Supabase is not configured."); setSaving(false); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session has expired. Sign in again.");
      const { data, error: insertError } = await supabase.from("patient_records").insert({
        hospital_id: hospitalId, reference_code: reference.trim(),
        external_reference: externalReference.trim() || null, care_area: careArea.trim() || null,
        created_by: user.id, status: "active",
      }).select("id,hospital_id,reference_code,external_reference,care_area,status,created_by,created_at,updated_at").single();
      if (insertError) throw insertError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospitalId, actor_id: user.id, entity_type: "patient_reference",
        entity_id: data.id, action: "patient_reference_created", details: { reference_code: data.reference_code, care_area: data.care_area },
      });
      const record = data as PatientRecord;
      setRecords(current => [record, ...current]); setSelected(record); setFilter("all"); setSearch("");
      setReference(""); setExternalReference(""); setCareArea(""); setShowCreate(false);
      setNotice(auditError ? "Patient reference saved, but the audit event could not be recorded." : `Reference ${record.reference_code} created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create patient reference. The reference may already exist in this hospital.");
    } finally { setSaving(false); }
  }

  async function changeStatus(record: PatientRecord, status: PatientStatus) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session has expired. Sign in again.");
      const { data, error: updateError } = await supabase.from("patient_records").update({ status })
        .eq("id", record.id).eq("hospital_id", hospitalId)
        .select("id,hospital_id,reference_code,external_reference,care_area,status,created_by,created_at,updated_at").single();
      if (updateError) throw updateError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospitalId, actor_id: user.id, entity_type: "patient_reference", entity_id: record.id,
        action: status === "archived" ? "patient_reference_archived" : "patient_reference_reactivated",
        details: { reference_code: record.reference_code },
      });
      const updated = data as PatientRecord;
      setRecords(current => current.map(item => item.id === updated.id ? updated : item));
      setSelected(updated);
      setNotice(auditError ? "Status updated, but the audit event could not be recorded." : `${updated.reference_code} marked ${status}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update this patient reference.");
    } finally { setSaving(false); }
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <Link href="/" className="auth-brand"><span className="auth-brand-mark"><Activity size={21} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="onboarding-signout" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <Link className="onboarding-signout" href="/"><ArrowLeft size={15} /> Workspace</Link>
        </div>
      </header>
      <div className="onboarding-content" style={{ maxWidth: 1180 }}>
        <div className="onboarding-heading"><span className="auth-overline">REFERENCE-FIRST OPERATIONS</span><h1>Patient references</h1><p>{hospitalName ? `${hospitalName} · ` : ""}A minimal operational directory using hospital references rather than a patient name list.</p></div>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        {notice && <div className="auth-alert success" role="status"><CheckCircle2 size={17} /> {notice}</div>}
        <section className="onboarding-card" style={{ marginBottom: 18 }}>
          <div className="onboarding-card-title"><span className="onboarding-icon"><UserRound size={20} /></span><div><h2>Reference directory</h2><p>{records.filter(item => item.status === "active").length} active reference(s) · {records.filter(item => item.status === "archived").length} archived</p></div><button className="auth-submit" style={{ width: "auto", marginLeft: "auto" }} onClick={() => setShowCreate(true)} disabled={loading || !hospitalId}><Plus size={16} /> Add reference</button></div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 18 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line, #e5ebef)", borderRadius: 8, padding: "9px 11px", flex: "1 1 240px" }}><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reference, external ID, care area" style={{ border: 0, outline: 0, width: "100%", minWidth: 0 }} /></label>
            <div style={{ display: "flex", gap: 6 }}>{(["active", "archived", "all"] as const).map(value => <button key={value} className={filter === value ? "auth-submit" : "onboarding-signout"} style={{ width: "auto", textTransform: "capitalize" }} onClick={() => setFilter(value)}>{value}</button>)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 18, marginTop: 18 }}>
            <div style={{ border: "1px solid var(--line, #e5ebef)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 500, borderCollapse: "collapse", textAlign: "left" }}>
                <thead><tr>{["Reference", "Care area", "Status", "Updated"].map(label => <th key={label} style={{ padding: "12px 10px", fontSize: 10, color: "var(--muted, #72818d)", borderBottom: "1px solid var(--line, #e5ebef)" }}>{label.toUpperCase()}</th>)}</tr></thead>
                <tbody>{visible.map(record => <tr key={record.id} onClick={() => setSelected(record)} style={{ cursor: "pointer", background: selected?.id === record.id ? "#edf7f5" : "#fff" }}><td style={{ padding: 11, borderBottom: "1px solid var(--line, #e5ebef)", fontWeight: 700, color: "#167c78", fontSize: 12 }}>{record.reference_code}<div style={{ color: "var(--muted, #72818d)", fontSize: 10, fontWeight: 400, marginTop: 4 }}>{record.external_reference || "No external reference"}</div></td><td style={{ padding: 11, borderBottom: "1px solid var(--line, #e5ebef)", fontSize: 12 }}>{record.care_area || "Not specified"}</td><td style={{ padding: 11, borderBottom: "1px solid var(--line, #e5ebef)", fontSize: 11 }}>{record.status}</td><td style={{ padding: 11, borderBottom: "1px solid var(--line, #e5ebef)", fontSize: 11, whiteSpace: "nowrap" }}>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(record.updated_at))}</td></tr>)}</tbody>
              </table></div>
              {loading && <p style={{ padding: 16, color: "var(--muted, #72818d)" }}>Loading hospital references…</p>}
              {!loading && visible.length === 0 && <p style={{ padding: 18, color: "var(--muted, #72818d)", fontSize: 13 }}>No references match this view. Add a reference to start the directory.</p>}
            </div>
            <aside style={{ border: "1px solid var(--line, #e5ebef)", borderRadius: 10, padding: 18, alignSelf: "start", background: "#fbfcfd" }}>
              <div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={18} /></span><div><h2>Selected reference</h2><p>Contextual record details</p></div></div>
              {selected ? <><h3 style={{ fontSize: 22, margin: "18px 0 8px", overflowWrap: "anywhere" }}>{selected.reference_code}</h3><p style={{ color: "var(--muted, #72818d)", fontSize: 12, margin: "0 0 16px" }}>Created {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(selected.created_at))}</p><dl className="approval-details"><div><dt>Care area</dt><dd>{selected.care_area || "Not specified"}</dd></div><div><dt>External reference</dt><dd>{selected.external_reference || "Not supplied"}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Last updated</dt><dd>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.updated_at))}</dd></div></dl><button className={selected.status === "active" ? "approval-reject" : "auth-submit"} style={{ marginTop: 16, width: "100%" }} disabled={saving} onClick={() => void changeStatus(selected, selected.status === "active" ? "archived" : "active")}>{selected.status === "active" ? <><Archive size={15} /> Archive reference</> : <><CheckCircle2 size={15} /> Reactivate reference</>}</button></> : <p style={{ color: "var(--muted, #72818d)", fontSize: 13, marginTop: 18 }}>Select a reference from the list to view its details.</p>}
            </aside>
          </div>
          <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted, #72818d)", fontSize: 12, marginTop: 18 }}><ShieldCheck size={15} /> This directory intentionally excludes patient names, diagnoses, and clinical notes. Do not put direct identifiers into reference or external-reference fields.</p>
        </section>
      </div>
      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="patient-create-title"><div className="modal-heading"><div><span className="modal-kicker">HOSPITAL WORKSPACE</span><h2 id="patient-create-title">Add patient reference</h2><p>Create a minimal reference for operational coordination.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} disabled={saving} aria-label="Close dialog">×</button></div><form onSubmit={createRecord}><label>Hospital reference<input required minLength={2} maxLength={80} value={reference} onChange={event => setReference(event.target.value)} placeholder="e.g. PT-10482" /></label><label>External reference (optional)<input maxLength={120} value={externalReference} onChange={event => setExternalReference(event.target.value)} placeholder="Use an approved non-identifying reference" /></label><label>Care area (optional)<input maxLength={120} value={careArea} onChange={event => setCareArea(event.target.value)} placeholder="e.g. Outpatient services" /></label><div className="form-note"><ShieldCheck size={16} /> Do not enter a patient’s name, date of birth, diagnosis, or clinical notes. The reference should not reveal identity on its own.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Create reference"} <ArrowRight size={15} /></button></div></form></section></div>}
    </main>
  );
}
