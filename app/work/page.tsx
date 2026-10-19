"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, ListChecks, Plus, RefreshCw, Search, ShieldCheck, Users, X, Save } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkType = "access_case" | "appointment" | "follow_up" | "exception" | "task";
type Priority = "low" | "medium" | "high" | "urgent";
type WorkStatus = "draft" | "open" | "needs_review" | "in_progress" | "awaiting_response" | "resolved" | "closed";
type PatientReference = { id: string; reference_code: string; care_area: string | null; status: "active" | "archived" };
type Row = { id: string; reference_code: string; title: string; summary: string | null; item_type: WorkType; priority: Priority; status: WorkStatus; owner_id: string | null; external_reference: string | null; due_at: string | null; patient_record_id: string | null; created_at: string; updated_at: string };
const labels: Record<WorkType,string> = { access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task" };
const statusLabels: Record<string,string> = { draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress", awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed" };
const titles: Record<string,string> = { access_case: "Access cases", appointment: "Appointment work", follow_up: "Follow-ups", exception: "Exceptions", task: "Tasks" };
const descriptions: Record<string,string> = { access_case: "Coordinate access-related operational work, from intake through resolution.", appointment: "Coordinate the operational actions related to appointment requests. Confirmed appointment times are managed in the patient-request workflow.", follow_up: "Keep promised callbacks, pending information, and next steps visible until they are completed.", exception: "Investigate blocked, overdue, or high-risk operational issues and record their resolution.", task: "Assign clear operational actions, monitor progress, and keep ownership and due dates visible." };
const validTypes: WorkType[] = ["access_case", "appointment", "follow_up", "exception", "task"];
const validStatuses: WorkStatus[] = ["draft", "open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed"];
const validPriorities: Priority[] = ["low", "medium", "high", "urgent"];

export default function WorkPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [type, setType] = useState<WorkType>("access_case");
  const [items, setItems] = useState<Row[]>([]);
  const [patientReferences, setPatientReferences] = useState<PatientReference[]>([]);
  const [newPatientRecordId, setNewPatientRecordId] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [showCreate, setShowCreate] = useState(false);
  const [newReference, setNewReference] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newExternalReference, setNewExternalReference] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newStatus, setNewStatus] = useState<WorkStatus>("open");
  const [newDueAt, setNewDueAt] = useState("");
  const [changingId, setChangingId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("type") ?? "access_case";
    if (validTypes.includes(value as WorkType)) setType(value as WorkType);
    const requestedStatus = params.get("status");
    if (requestedStatus && ["all", ...validStatuses].includes(requestedStatus)) setStatus(requestedStatus);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
      setUserId(auth.user.id);
      const { data: memberships, error: memberError } = await supabase.from("hospital_memberships").select("hospital_id,role,created_at").order("created_at", { ascending: false }).limit(10);
      if (memberError) throw memberError;
      let selected: { hospital_id: string; role: string } | null = null;
      for (const membership of memberships ?? []) {
        const { data: candidate, error: hospitalError } = await supabase.from("hospitals").select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
        if (hospitalError) throw hospitalError;
        if (candidate?.status === "active") {
          selected = { hospital_id: membership.hospital_id, role: membership.role };
          setHospitalId(membership.hospital_id); setHospitalName(candidate.name); setRole(membership.role);
          break;
        }
      }
      if (!selected) {
        const { data: owned, error: ownedError } = await supabase.from("hospitals").select("id,name,status").eq("created_by", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (ownedError) throw ownedError;
        if (owned && owned.status !== "active") throw new Error("This hospital workspace must be approved before operational records are available.");
        throw new Error("No active hospital membership was found for this account.");
      }
      const [{ data, error: itemsError }, { data: refs, error: refsError }] = await Promise.all([
        supabase.from("work_items").select("id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,patient_record_id,created_at,updated_at").eq("hospital_id", selected.hospital_id).eq("item_type", type).order("updated_at", { ascending: false }).limit(200),
        supabase.from("patient_records").select("id,reference_code,care_area,status").eq("hospital_id", selected.hospital_id).eq("status", "active").order("reference_code", { ascending: true }).limit(500)
      ]);
      if (itemsError) throw itemsError;
      if (refsError) throw new Error("Unable to load patient references. Confirm the patient-reference migration has been applied.");
      setItems((data ?? []) as Row[]);
      setPatientReferences((refs ?? []) as PatientReference[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load operational records."); }
    finally { setLoading(false); }
  }, [router, supabase, type]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => {
    const matchesStatus = status === "all" || item.status === status || (status === "open" && !["resolved","closed"].includes(item.status));
    const q = search.trim().toLowerCase();
    const linkedReference = patientReferences.find(reference => reference.id === item.patient_record_id)?.reference_code ?? "";
    return matchesStatus && (!q || [item.reference_code,item.title,item.external_reference ?? "",item.status,linkedReference].some(v => v.toLowerCase().includes(q)));
  }), [items, patientReferences, search, status]);

  const canCreate = ["owner", "admin", "clinician", "operations"].includes(role);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !hospitalId || !userId) return;
    const reference = newReference.trim();
    const title = newTitle.trim();
    if (reference.length < 2 || reference.length > 80 || title.length < 3 || title.length > 240) {
      setError("Enter a reference of 2–80 characters and a title of 3–240 characters."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: insertError } = await supabase.from("work_items").insert({
        hospital_id: hospitalId, reference_code: reference, title, summary: newSummary.trim() || null,
        item_type: type, priority: newPriority, status: newStatus, external_reference: newExternalReference.trim() || null,
        patient_record_id: newPatientRecordId || null, due_at: newDueAt ? new Date(newDueAt).toISOString() : null, created_by: userId
      }).select("id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,patient_record_id,created_at,updated_at").single();
      if (insertError) throw insertError;
      setItems(current => [data as Row, ...current]);
      setShowCreate(false); setNewReference(""); setNewTitle(""); setNewSummary(""); setNewExternalReference(""); setNewPatientRecordId(""); setNewPriority("medium"); setNewStatus("open"); setNewDueAt("");
      setNotice("Operational record created. The change is recorded by the database audit trigger.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create this record. Check that the reference is unique within your hospital."); }
    finally { setSaving(false); }
  }

  async function updateStatus(item: Row, nextStatus: WorkStatus) {
    if (!supabase || !hospitalId || !userId || nextStatus === item.status) return;
    setChangingId(item.id); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items").update({ status: nextStatus }).eq("id", item.id).eq("hospital_id", hospitalId).select("id,status,updated_at").single();
      if (updateError) throw updateError;
      setItems(current => current.map(row => row.id === item.id ? { ...row, status: data.status as WorkStatus, updated_at: data.updated_at } : row));
      setNotice("Record status updated. The change is recorded by the database audit trigger.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update this record."); }
    finally { setChangingId(""); }
  }

  const openCount = items.filter(item => !["resolved", "closed"].includes(item.status)).length;
  const reviewCount = items.filter(item => item.status === "needs_review" || item.status === "awaiting_response").length;
  const urgentCount = items.filter(item => ["high", "urgent"].includes(item.priority) && !["resolved", "closed"].includes(item.status)).length;
  const overdueCount = items.filter(item => item.due_at && new Date(item.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(item.status)).length;
  const viewTabs: { value: WorkType; label: string }[] = [
    { value: "access_case", label: "Access cases" },
    { value: "follow_up", label: "Follow-ups" },
    { value: "task", label: "Tasks" },
    { value: "exception", label: "Exceptions" },
    { value: "appointment", label: "Appointment work" },
  ];
  const pageIcon = type === "appointment" ? <CalendarDays size={19} /> : type === "exception" ? <AlertCircle size={19} /> : type === "follow_up" ? <Clock3 size={19} /> : type === "task" ? <ListChecks size={19} /> : <Users size={19} />;

  return (
    <main className="ops-queue-page">
      <header className="ops-queue-topbar">
        <Link href="/" className="ops-queue-brand">
          <span className="ops-queue-brand-mark"><Activity size={20} /></span>
          <span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span>
        </Link>
        <div className="ops-queue-topbar-right">
          <span className="ops-queue-hospital"><span className="ops-live-dot" />{hospitalName || "Hospital workspace"}</span>
          <Link href="/audit" className="ops-queue-utility"><ShieldCheck size={15} /> Audit history</Link>
          <Link href="/my-work" className="ops-queue-utility"><ClipboardCheck size={15} /> My work</Link>
        </div>
      </header>

      <div className="ops-queue-content">
        <div className="ops-queue-breadcrumb"><Link href="/">Workspace</Link><span>/</span><span>Operations</span><span>/</span><strong>{titles[type]}</strong></div>

        <div className="ops-queue-heading">
          <div className="ops-queue-heading-copy">
            <div className="ops-queue-eyebrow">{pageIcon}<span>OPERATIONS WORKSPACE</span></div>
            <h1>{titles[type] ?? "Operational work"}</h1>
            <p>{descriptions[type] ?? "Review and coordinate operational work."}</p>
          </div>
          <div className="ops-queue-heading-actions">
            <button className="ops-queue-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "ops-spin" : ""} /> Refresh</button>
            {canCreate && <button className="ops-queue-primary-button" onClick={() => { setError(""); setNotice(""); setShowCreate(true); }}><Plus size={16} /> New {labels[type].toLowerCase()}</button>}
          </div>
        </div>

        <nav className="ops-queue-tabs" aria-label="Operational queues">
          {viewTabs.map(tab => (
            <Link key={tab.value} href={`/work?type=${tab.value}`} className={type === tab.value ? "ops-queue-tab active" : "ops-queue-tab"}>
              {tab.label}
            </Link>
          ))}
          <Link href="/appointments" className="ops-queue-tab">Scheduled appointments <ArrowRight size={13} /></Link>
        </nav>

        {error && <div className="ops-queue-alert error" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        {notice && <div className="ops-queue-alert success" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={15} /></button></div>}

        <section className="ops-queue-metrics" aria-label="Queue overview">
          <article><span>Open {titles[type].toLowerCase()}</span><strong>{loading ? "—" : openCount}</strong><small>Items not yet resolved or closed</small></article>
          <article><span>Needs attention</span><strong>{loading ? "—" : reviewCount}</strong><small>Review or response required</small></article>
          <article className={urgentCount > 0 ? "warn" : ""}><span>High priority</span><strong>{loading ? "—" : urgentCount}</strong><small>High or urgent open items</small></article>
          <article className={overdueCount > 0 ? "warn" : ""}><span>Overdue</span><strong>{loading ? "—" : overdueCount}</strong><small>Past due date and still open</small></article>
        </section>

        <section className="ops-queue-panel">
          <div className="ops-queue-panel-heading">
            <div><span className="ops-queue-overline">WORK REGISTER</span><h2>{titles[type]}</h2><p>Search records, inspect ownership and update operational status.</p></div>
            <span className="ops-queue-result-count">{loading ? "Loading…" : `${visible.length} shown`}</span>
          </div>
          <div className="ops-queue-toolbar">
            <label className="ops-queue-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reference, title or patient reference" aria-label="Search this queue" /></label>
            <label className="ops-queue-status-filter"><span>Status</span><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="open">Open items</option><option value="needs_review">Needs review</option><option value="in_progress">In progress</option><option value="awaiting_response">Awaiting response</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All statuses</option></select></label>
          </div>

          {loading ? (
            <div className="ops-queue-state"><span className="ops-queue-state-mark"><RefreshCw size={19} className="ops-spin"/></span><strong>Loading authorised records</strong><p>Retrieving records for your active hospital workspace.</p></div>
          ) : visible.length === 0 ? (
            <div className="ops-queue-state"><span className="ops-queue-state-mark"><CheckCircle2 size={21}/></span><strong>No matching {labels[type].toLowerCase()} records</strong><p>{search || status !== "open" ? "Try another search or status filter." : "This queue is clear. New records will appear here when they are created."}</p>{canCreate && !search && status === "open" && <button className="ops-queue-primary-button" onClick={() => { setError(""); setNotice(""); setShowCreate(true); }}><Plus size={15}/> Create first record</button>}</div>
          ) : (
            <div className="ops-queue-table-wrap">
              <table className="ops-queue-table">
                <thead><tr><th>Reference / record</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due date</th><th>Last updated</th><th>Update status</th></tr></thead>
                <tbody>{visible.map(item => {
                  const linked = patientReferences.find(reference => reference.id === item.patient_record_id);
                  const overdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(item.status);
                  return <tr key={item.id}>
                    <td data-label="Reference / record"><div className="ops-queue-record-ref">{item.reference_code}</div><div className="ops-queue-record-title">{item.title}</div>{linked && <span className="ops-queue-patient-ref">Patient ref · {linked.reference_code}{linked.care_area ? ` · ${linked.care_area}` : ""}</span>}{item.summary && <p className="ops-queue-record-summary">{item.summary}</p>}</td>
                    <td data-label="Status"><span className={`ops-queue-status-pill ops-status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span></td>
                    <td data-label="Priority"><span className={`ops-queue-priority ops-priority-${item.priority}`}>{item.priority}</span></td>
                    <td data-label="Owner"><span className={item.owner_id ? "ops-queue-owner" : "ops-queue-owner unassigned"}>{item.owner_id ? "Assigned" : "Unassigned"}</span></td>
                    <td data-label="Due date"><span className={overdue ? "ops-queue-due overdue" : "ops-queue-due"}>{item.due_at ? new Date(item.due_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No due date"}</span></td>
                    <td data-label="Last updated"><span className="ops-queue-date">{new Date(item.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span></td>
                    <td data-label="Update status"><select aria-label={"Update status for " + item.reference_code} value={item.status} disabled={changingId === item.id} onChange={e => void updateStatus(item, e.target.value as WorkStatus)} className="ops-queue-row-select">{validStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
          <div className="ops-queue-panel-footer"><span>Hospital-scoped records · Updates follow workspace permissions.</span><Link href="/reports">View reporting <ArrowRight size={14}/></Link></div>
        </section>
        <p className="ops-queue-privacy"><ShieldCheck size={15}/> Use operational references only. Do not put direct patient identifiers, diagnoses or clinical notes into record titles or summaries.</p>
      </div>

      {showCreate && <div className="ops-queue-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setShowCreate(false); }}>
        <section className="ops-queue-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="ops-queue-modal-heading"><div><span className="ops-queue-overline">NEW {labels[type].toUpperCase()}</span><h2 id="create-title">Create {labels[type].toLowerCase()}</h2><p>Keep the description operational and reference-first.</p></div><button className="ops-queue-close" aria-label="Close form" onClick={() => setShowCreate(false)} disabled={saving}><X size={19}/></button></div>
          <form className="ops-queue-form" onSubmit={createItem}>
            <label>Internal reference *<input required minLength={2} maxLength={80} value={newReference} onChange={e => setNewReference(e.target.value)} placeholder={type === "access_case" ? "e.g. AC-2026-001" : type === "appointment" ? "e.g. AP-2026-001" : type === "follow_up" ? "e.g. FU-2026-001" : type === "exception" ? "e.g. EX-2026-001" : "e.g. TK-2026-001"}/></label>
            <label>Title *<input required minLength={3} maxLength={240} value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Brief operational description"/></label>
            <label className="full">Linked patient reference (optional)<select value={newPatientRecordId} onChange={e => setNewPatientRecordId(e.target.value)}><option value="">No patient reference linked</option>{patientReferences.map(reference => <option key={reference.id} value={reference.id}>{reference.reference_code}{reference.care_area ? " · " + reference.care_area : ""}</option>)}</select><small>Only active references from this hospital are available.</small></label>
            <label>Priority<select value={newPriority} onChange={e => setNewPriority(e.target.value as Priority)}>{validPriorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
            <label>Initial status<select value={newStatus} onChange={e => setNewStatus(e.target.value as WorkStatus)}>{validStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
            <label>External reference (optional)<input maxLength={120} value={newExternalReference} onChange={e => setNewExternalReference(e.target.value)} placeholder="Non-sensitive external ID"/></label>
            <label>Due date (optional)<input type="datetime-local" value={newDueAt} onChange={e => setNewDueAt(e.target.value)}/></label>
            <label className="full">Summary (optional)<textarea maxLength={2000} rows={3} value={newSummary} onChange={e => setNewSummary(e.target.value)} placeholder="Short operational context; avoid clinical details and direct identifiers."/></label>
            <div className="ops-queue-form-actions"><button type="button" className="ops-queue-secondary-button" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button><button type="submit" className="ops-queue-primary-button" disabled={saving}><Save size={15}/>{saving ? "Saving…" : "Create record"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
