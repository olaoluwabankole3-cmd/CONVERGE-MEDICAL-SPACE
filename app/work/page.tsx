"use client";

import HospitalWorkspaceSwitcher from "@/components/hospital-workspace-switcher";
import { getSelectedHospitalId } from "@/lib/client/hospital-workspace";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck,
  Clock3, ExternalLink, Eye, ListChecks, Pencil, Plus, RefreshCw, Search,
  ShieldCheck, Users, X, Save, UserCheck
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkType = "access_case" | "appointment" | "follow_up" | "exception" | "task";
type Priority = "low" | "medium" | "high" | "urgent";
type WorkStatus = "draft" | "open" | "needs_review" | "in_progress" | "awaiting_response" | "resolved" | "closed";
type PatientReference = { id: string; reference_code: string; care_area: string | null; status: "active" | "archived" };
type Row = {
  id: string; reference_code: string; title: string; summary: string | null; item_type: WorkType;
  priority: Priority; status: WorkStatus; owner_id: string | null; external_reference: string | null;
  due_at: string | null; patient_record_id: string | null; patient_request_id: string | null;
  created_at: string; updated_at: string;
};

const labels: Record<WorkType, string> = {
  access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task"
};
const statusLabels: Record<string, string> = {
  draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress",
  awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed"
};
const titles: Record<string, string> = {
  access_case: "Access cases", appointment: "Appointment work", follow_up: "Follow-ups", exception: "Exceptions", task: "Tasks"
};
const descriptions: Record<string, string> = {
  access_case: "Review access work, confirm ownership and move each case toward a documented outcome.",
  appointment: "Coordinate the operational actions related to appointment requests. Appointment proposals and confirmation remain in Patient Requests.",
  follow_up: "Keep callbacks, pending information and next steps visible until they are completed.",
  exception: "Investigate blocked, overdue or high-priority operational issues and record their resolution.",
  task: "Track clear operational actions, ownership and due dates in one place."
};
const validTypes: WorkType[] = ["access_case", "appointment", "follow_up", "exception", "task"];
const validStatuses: WorkStatus[] = ["draft", "open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed"];
const validPriorities: Priority[] = ["low", "medium", "high", "urgent"];
const selectFields = "id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,patient_record_id,patient_request_id,created_at,updated_at";

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-GB", includeTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

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
  const [changingId, setChangingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedItem, setSelectedItem] = useState<Row | null>(null);
  const [newReference, setNewReference] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newExternalReference, setNewExternalReference] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newStatus, setNewStatus] = useState<WorkStatus>("open");
  const [newDueAt, setNewDueAt] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("type") ?? "access_case";
    if (validTypes.includes(value as WorkType)) setType(value as WorkType);
    const requestedStatus = params.get("status");
    if (requestedStatus && ["all", ...validStatuses].includes(requestedStatus)) setStatus(requestedStatus);
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      if (showCreate) setShowCreate(false);
      else if (selectedItem) setSelectedItem(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [saving, showCreate, selectedItem]);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
      setUserId(auth.user.id);

      const requestedHospitalId = getSelectedHospitalId();
      const { data: memberships, error: memberError } = await supabase.from("hospital_memberships")
        .select("hospital_id,role,created_at").order("created_at", { ascending: false }).limit(100);
      if (memberError) throw memberError;

      let selected: { hospital_id: string; role: string } | null = null;
      if (requestedHospitalId) {
        const membership = (memberships ?? []).find(item => item.hospital_id === requestedHospitalId);
        if (!membership) throw new Error("You do not have access to the selected hospital workspace.");
        const { data: candidate, error: hospitalError } = await supabase.from("hospitals")
          .select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
        if (hospitalError) throw hospitalError;
        if (!candidate || candidate.status !== "active") throw new Error("This hospital workspace is not active.");
        selected = { hospital_id: membership.hospital_id, role: membership.role };
        setHospitalId(membership.hospital_id); setHospitalName(candidate.name); setRole(membership.role);
      } else {
        for (const membership of memberships ?? []) {
          const { data: candidate, error: hospitalError } = await supabase.from("hospitals")
            .select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
          if (hospitalError) throw hospitalError;
          if (candidate?.status === "active") {
            selected = { hospital_id: membership.hospital_id, role: membership.role };
            setHospitalId(membership.hospital_id); setHospitalName(candidate.name); setRole(membership.role);
            break;
          }
        }
      }
      if (!selected) {
        const { data: owned, error: ownedError } = await supabase.from("hospitals")
          .select("id,name,status").eq("created_by", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (ownedError) throw ownedError;
        if (owned && owned.status !== "active") throw new Error("This hospital workspace must be approved before operational records are available.");
        throw new Error("No active hospital membership was found for this account.");
      }

      const [{ data, error: itemsError }, { data: refs, error: refsError }] = await Promise.all([
        supabase.from("work_items").select(selectFields).eq("hospital_id", selected.hospital_id)
          .eq("item_type", type).order("updated_at", { ascending: false }).limit(200),
        supabase.from("patient_records").select("id,reference_code,care_area,status").eq("hospital_id", selected.hospital_id)
          .eq("status", "active").order("reference_code", { ascending: true }).limit(500)
      ]);
      if (itemsError) throw itemsError;
      if (refsError) throw new Error("Unable to load patient references. Confirm the patient-reference migration has been applied.");
      setItems((data ?? []) as Row[]);
      setPatientReferences((refs ?? []) as PatientReference[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load operational records.");
    } finally { setLoading(false); }
  }, [router, supabase, type]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => {
    const matchesStatus = status === "all" || item.status === status || (status === "open" && !["resolved", "closed"].includes(item.status));
    const query = search.trim().toLowerCase();
    const linkedReference = patientReferences.find(reference => reference.id === item.patient_record_id)?.reference_code ?? "";
    return matchesStatus && (!query || [item.reference_code, item.title, item.external_reference ?? "", item.status, linkedReference]
      .some(value => value.toLowerCase().includes(query)));
  }), [items, patientReferences, search, status]);

  const canCreate = ["owner", "admin", "clinician", "operations"].includes(role);
  const canUpdate = ["owner", "admin", "clinician", "operations", "reviewer"].includes(role);

  function openCreate() {
    setError(""); setNotice(""); setEditingId("");
    setNewReference(""); setNewTitle(""); setNewSummary(""); setNewExternalReference("");
    setNewPatientRecordId(""); setNewPriority("medium"); setNewStatus("open"); setNewDueAt("");
    setShowCreate(true);
  }

  function openEdit(item: Row) {
    if (item.patient_request_id) {
      setError("This case is linked to a patient request. Manage its core workflow from Patient Requests.");
      return;
    }
    setError(""); setNotice(""); setEditingId(item.id); setSelectedItem(item);
    setNewReference(item.reference_code); setNewTitle(item.title); setNewSummary(item.summary ?? "");
    setNewExternalReference(item.external_reference ?? ""); setNewPatientRecordId(item.patient_record_id ?? "");
    setNewPriority(item.priority); setNewStatus(item.status); setNewDueAt(toLocalDateTime(item.due_at));
    setShowCreate(true);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !hospitalId || !userId) return;
    const reference = newReference.trim();
    const title = newTitle.trim();
    if ((!editingId && (reference.length < 2 || reference.length > 80)) || title.length < 3 || title.length > 240) {
      setError("Enter a reference of 2–80 characters and a title of 3–240 characters."); return;
    }

    setSaving(true); setError(""); setNotice("");
    const editableFields = {
      title,
      summary: newSummary.trim() || null,
      priority: newPriority,
      status: newStatus,
      external_reference: newExternalReference.trim() || null,
      patient_record_id: newPatientRecordId || null,
      due_at: newDueAt ? new Date(newDueAt).toISOString() : null
    };
    try {
      if (editingId) {
        const { data, error: updateError } = await supabase.from("work_items").update(editableFields)
          .eq("id", editingId).eq("hospital_id", hospitalId).select(selectFields).single();
        if (updateError) throw updateError;
        const updated = data as Row;
        setItems(current => current.map(row => row.id === updated.id ? updated : row));
        setSelectedItem(updated);
        setNotice("Case details saved.");
      } else {
        const { data, error: insertError } = await supabase.from("work_items").insert({
          hospital_id: hospitalId, reference_code: reference, ...editableFields,
          item_type: type, created_by: userId
        }).select(selectFields).single();
        if (insertError) throw insertError;
        setItems(current => [data as Row, ...current]);
        setSelectedItem(null);
        setNotice("New record created.");
      }
      setShowCreate(false);
      setEditingId("");
      setNewReference(""); setNewTitle(""); setNewSummary(""); setNewExternalReference("");
      setNewPatientRecordId(""); setNewPriority("medium"); setNewStatus("open"); setNewDueAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this record. Check your permissions and the hospital reference.");
    } finally { setSaving(false); }
  }

  async function updateStatus(item: Row, nextStatus: WorkStatus) {
    if (!supabase || !hospitalId || !userId || nextStatus === item.status) return;
    if (item.patient_request_id) {
      setError("This case is tied to a patient request. Update the workflow in Patient Requests to keep records in sync.");
      return;
    }
    if (!canUpdate) { setError("Your current role does not have permission to update this case."); return; }
    setChangingId(item.id); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items").update({ status: nextStatus })
        .eq("id", item.id).eq("hospital_id", hospitalId).select("id,status,updated_at").single();
      if (updateError) throw updateError;
      const updated = { ...item, status: data.status as WorkStatus, updated_at: data.updated_at };
      setItems(current => current.map(row => row.id === item.id ? updated : row));
      setSelectedItem(current => current?.id === item.id ? updated : current);
      setNotice("Status updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update this record.");
    } finally { setChangingId(""); }
  }

  async function assignToMe(item: Row) {
    if (!supabase || !hospitalId || !userId || !canUpdate) return;
    const nextOwner = item.owner_id === userId ? null : userId;
    setChangingId(item.id); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items").update({ owner_id: nextOwner })
        .eq("id", item.id).eq("hospital_id", hospitalId).select("owner_id,updated_at").single();
      if (updateError) throw updateError;
      const updated = { ...item, owner_id: data.owner_id as string | null, updated_at: data.updated_at };
      setItems(current => current.map(row => row.id === item.id ? { ...row, owner_id: updated.owner_id, updated_at: updated.updated_at } : row));
      setSelectedItem(current => current?.id === item.id ? updated : current);
      setNotice(nextOwner ? "Case assigned to you." : "Case unassigned from your account.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update case ownership. Check that the assignment migrations are applied and the staff account is active.");
    } finally { setChangingId(""); }
  }

  const openCount = items.filter(item => !["resolved", "closed"].includes(item.status)).length;
  const reviewCount = items.filter(item => item.status === "needs_review" || item.status === "awaiting_response").length;
  const urgentCount = items.filter(item => ["high", "urgent"].includes(item.priority) && !["resolved", "closed"].includes(item.status)).length;
  const overdueCount = items.filter(item => item.due_at && new Date(item.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(item.status)).length;
  const viewTabs: { value: WorkType; label: string }[] = [
    { value: "access_case", label: "Access cases" }, { value: "follow_up", label: "Follow-ups" },
    { value: "task", label: "Tasks" }, { value: "exception", label: "Exceptions" }, { value: "appointment", label: "Appointment work" }
  ];
  const pageIcon = type === "appointment" ? <CalendarDays size={18} /> : type === "exception" ? <AlertCircle size={18} />
    : type === "follow_up" ? <Clock3 size={18} /> : type === "task" ? <ListChecks size={18} /> : <Users size={18} />;

  return (
    <main className="ops-queue-page">
      <header className="ops-queue-topbar">
        <Link href="/" className="ops-queue-brand"><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo app-section-logo" /></Link>
        <div className="ops-queue-topbar-right">
          <span className="ops-queue-hospital"><span className="ops-live-dot" />{hospitalName || "Hospital workspace"}</span>
          <Link href="/audit" className="ops-queue-utility"><ShieldCheck size={15} /> Audit history</Link>
          <Link href="/my-work" className="ops-queue-utility"><ClipboardCheck size={15} /> My work</Link>
        </div>
      </header>
      <HospitalWorkspaceSwitcher />

      <div className="ops-queue-content">
        <div className="ops-queue-breadcrumb"><Link href="/">Workspace</Link><span>/</span><span>Operations</span><span>/</span><strong>{titles[type]}</strong></div>
        <div className="ops-queue-heading">
          <div className="ops-queue-heading-copy">
            <div className="ops-queue-eyebrow">{pageIcon}<span>OPERATIONS WORKSPACE</span></div>
            <h1>{titles[type]}</h1><p>{descriptions[type]}</p>
          </div>
          <div className="ops-queue-heading-actions">
            <button type="button" className="ops-queue-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "ops-spin" : ""} /> Refresh</button>
            {canCreate && <button type="button" className="ops-queue-primary-button" onClick={openCreate}><Plus size={16} /> New {labels[type].toLowerCase()}</button>}
          </div>
        </div>

        <nav className="ops-queue-tabs" aria-label="Operational queues">
          {viewTabs.map(tab => <Link key={tab.value} href={"/work?type=" + tab.value}
            onClick={() => { setType(tab.value); setStatus("open"); setSearch(""); }}
            className={type === tab.value ? "ops-queue-tab active" : "ops-queue-tab"}>{tab.label}</Link>)}
          <Link href="/appointments" className="ops-queue-tab">Scheduled appointments <ArrowRight size={13} /></Link>
        </nav>

        {error && <div className="ops-queue-alert error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        {notice && <div className="ops-queue-alert success" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={15} /></button></div>}

        <section className="ops-queue-metrics" aria-label="Queue overview">
          <article><span>Open {titles[type].toLowerCase()}</span><strong>{loading ? "—" : openCount}</strong><small>Not yet resolved or closed</small></article>
          <article><span>Needs attention</span><strong>{loading ? "—" : reviewCount}</strong><small>Review or response required</small></article>
          <article className={urgentCount > 0 ? "warn" : ""}><span>High priority</span><strong>{loading ? "—" : urgentCount}</strong><small>High or urgent open items</small></article>
          <article className={overdueCount > 0 ? "warn" : ""}><span>Overdue</span><strong>{loading ? "—" : overdueCount}</strong><small>Past due and still open</small></article>
        </section>

        <section className="ops-queue-panel">
          <div className="ops-queue-panel-heading"><div><span className="ops-queue-overline">WORK REGISTER</span><h2>{titles[type]}</h2><p>Select a record to review details and available actions.</p></div><span className="ops-queue-result-count">{loading ? "Loading…" : visible.length + " shown"}</span></div>
          <div className="ops-queue-toolbar">
            <label className="ops-queue-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reference, title or patient reference" aria-label="Search this queue" /></label>
            <label className="ops-queue-status-filter"><span>Status</span><select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open items</option><option value="needs_review">Needs review</option><option value="in_progress">In progress</option><option value="awaiting_response">Awaiting response</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All statuses</option></select></label>
            {(search || status !== "open") && <button type="button" className="ops-queue-clear-filters" onClick={() => { setSearch(""); setStatus("open"); }}>Clear filters</button>}
          </div>

          {loading ? <div className="ops-queue-state"><span className="ops-queue-state-mark"><RefreshCw size={19} className="ops-spin" /></span><strong>Loading authorised records</strong><p>Retrieving records for your active hospital workspace.</p></div>
          : visible.length === 0 ? <div className="ops-queue-state"><span className="ops-queue-state-mark"><CheckCircle2 size={21} /></span><strong>No matching {labels[type].toLowerCase()} records</strong><p>{search || status !== "open" ? "Try another search or clear the filters." : "This queue is clear. New records will appear here when created."}</p>{canCreate && !search && status === "open" && <button type="button" className="ops-queue-primary-button" onClick={openCreate}><Plus size={15} /> Create first record</button>}</div>
          : <div className="ops-queue-table-wrap"><table className="ops-queue-table">
            <thead><tr><th>Reference / record</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due date</th><th>Last updated</th><th>Actions</th></tr></thead>
            <tbody>{visible.map(item => {
              const linked = patientReferences.find(reference => reference.id === item.patient_record_id);
              const overdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(item.status);
              const ownerLabel = item.owner_id === userId ? "You" : item.owner_id ? "Assigned" : "Unassigned";
              return <tr key={item.id}>
                <td data-label="Reference / record"><div className="ops-queue-record-ref">{item.reference_code}</div><div className="ops-queue-record-title">{item.title}</div>{linked && <span className="ops-queue-patient-ref">Patient ref · {linked.reference_code}{linked.care_area ? " · " + linked.care_area : ""}</span>}{item.summary && <p className="ops-queue-record-summary">{item.summary}</p>}</td>
                <td data-label="Status"><span className={"ops-queue-status-pill ops-status-" + item.status}>{statusLabels[item.status] ?? item.status}</span>{item.patient_request_id && <span className="ops-queue-workflow-note">Request workflow</span>}</td>
                <td data-label="Priority"><span className={"ops-queue-priority ops-priority-" + item.priority}>{item.priority}</span></td>
                <td data-label="Owner"><span className={item.owner_id ? "ops-queue-owner" : "ops-queue-owner unassigned"}>{ownerLabel}</span></td>
                <td data-label="Due date"><span className={overdue ? "ops-queue-due overdue" : "ops-queue-due"}>{item.due_at ? formatDate(item.due_at) : "No due date"}</span></td>
                <td data-label="Last updated"><span className="ops-queue-date">{formatDate(item.updated_at)}</span></td>
                <td data-label="Actions"><button type="button" className="ops-queue-row-action" onClick={() => setSelectedItem(item)}><Eye size={14} /> Details</button></td>
              </tr>;
            })}</tbody>
          </table></div>}
          <div className="ops-queue-panel-footer"><span>Hospital-scoped records · Changes follow workspace permissions.</span><Link href="/reports">View reporting <ArrowRight size={14} /></Link></div>
        </section>
        <p className="ops-queue-privacy"><ShieldCheck size={15} /> Use operational references only. Keep direct patient identifiers, diagnoses and clinical notes out of general case titles and summaries.</p>
      </div>

      {selectedItem && <div className="ops-queue-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setSelectedItem(null); }}>
        <section className="ops-queue-modal ops-queue-detail-modal" role="dialog" aria-modal="true" aria-labelledby="case-detail-title">
          <div className="ops-queue-modal-heading"><div><span className="ops-queue-overline">{labels[selectedItem.item_type]} · {selectedItem.reference_code}</span><h2 id="case-detail-title">{selectedItem.title}</h2><p>Review the record, confirm ownership and take the next permitted action.</p></div><button type="button" className="ops-queue-close" aria-label="Close case details" onClick={() => setSelectedItem(null)}><X size={19} /></button></div>
          <div className="ops-queue-detail-body">
            <div className="ops-queue-detail-badges"><span className={"ops-queue-status-pill ops-status-" + selectedItem.status}>{statusLabels[selectedItem.status] ?? selectedItem.status}</span><span className={"ops-queue-priority ops-priority-" + selectedItem.priority}>{selectedItem.priority} priority</span>{selectedItem.patient_request_id && <span className="ops-queue-request-linked">Linked patient request</span>}</div>
            <p className="ops-queue-detail-summary">{selectedItem.summary || "No additional summary has been recorded for this item."}</p>
            <dl className="ops-queue-detail-facts">
              <div><dt>Internal reference</dt><dd>{selectedItem.reference_code}</dd></div>
              <div><dt>Owner</dt><dd>{selectedItem.owner_id === userId ? "Assigned to you" : selectedItem.owner_id ? "Assigned to another staff member" : "Unassigned"}</dd></div>
              <div><dt>Due date</dt><dd>{formatDate(selectedItem.due_at, true)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(selectedItem.updated_at, true)}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(selectedItem.created_at, true)}</dd></div>
              <div><dt>External reference</dt><dd>{selectedItem.external_reference || "Not provided"}</dd></div>
            </dl>
            {(() => {
              const linked = patientReferences.find(reference => reference.id === selectedItem.patient_record_id);
              return linked ? <div className="ops-queue-linked-reference"><span>Patient reference</span><strong>{linked.reference_code}</strong>{linked.care_area && <small>{linked.care_area}</small>}</div> : null;
            })()}
            <div className="ops-queue-detail-actions">
              {canUpdate && <button type="button" className="ops-queue-secondary-button" onClick={() => void assignToMe(selectedItem)} disabled={changingId === selectedItem.id}><UserCheck size={15} />{changingId === selectedItem.id ? "Updating…" : selectedItem.owner_id === userId ? "Unassign from me" : "Assign to me"}</button>}
              {canUpdate && !selectedItem.patient_request_id && <button type="button" className="ops-queue-secondary-button" onClick={() => openEdit(selectedItem)}><Pencil size={15} /> Edit details</button>}
              {selectedItem.patient_request_id && <Link className="ops-queue-primary-button" href={"/requests?requestId=" + encodeURIComponent(selectedItem.patient_request_id)} onClick={() => setSelectedItem(null)}><ExternalLink size={15} /> Review patient request</Link>}
            </div>
            {selectedItem.patient_request_id
              ? <div className="ops-queue-detail-guidance"><ShieldCheck size={15} /><p>This case is connected to a patient request. Review messages, appointment decisions and request outcomes in the governed request workflow to keep both records in sync.</p></div>
              : <div className="ops-queue-detail-status"><label htmlFor="case-status-select">Update status</label><select id="case-status-select" value={selectedItem.status} disabled={!canUpdate || changingId === selectedItem.id} onChange={event => void updateStatus(selectedItem, event.target.value as WorkStatus)}>{validStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select>{!canUpdate && <small>Your current role is read-only for case updates.</small>}</div>}
            {!canUpdate && <p className="ops-queue-readonly-note">Your current role can view this record but cannot change ownership or details.</p>}
          </div>
          <div className="ops-queue-detail-footer"><span>Changes apply to this hospital workspace only.</span><button type="button" className="ops-queue-secondary-button" onClick={() => setSelectedItem(null)}>Done</button></div>
        </section>
      </div>}

      {showCreate && <div className="ops-queue-modal-backdrop ops-queue-form-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
        <section className="ops-queue-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="ops-queue-modal-heading"><div><span className="ops-queue-overline">{editingId ? "EDIT " : "NEW "}{labels[type].toUpperCase()}</span><h2 id="create-title">{editingId ? "Edit " + labels[type].toLowerCase() : "New " + labels[type].toLowerCase()}</h2><p>Keep the description operational and reference-first.</p></div><button type="button" className="ops-queue-close" aria-label="Close form" onClick={() => setShowCreate(false)} disabled={saving}><X size={19} /></button></div>
          <form className="ops-queue-form" onSubmit={saveItem}>
            <label>Internal reference *<input required minLength={2} maxLength={80} value={newReference} onChange={event => setNewReference(event.target.value)} disabled={!!editingId} placeholder={type === "access_case" ? "e.g. AC-2026-001" : type === "appointment" ? "e.g. AP-2026-001" : type === "follow_up" ? "e.g. FU-2026-001" : type === "exception" ? "e.g. EX-2026-001" : "e.g. TK-2026-001"} /></label>
            <label>Title *<input required minLength={3} maxLength={240} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="Brief operational description" /></label>
            <label className="full">Linked patient reference (optional)<select value={newPatientRecordId} onChange={event => setNewPatientRecordId(event.target.value)}><option value="">No patient reference linked</option>{patientReferences.map(reference => <option key={reference.id} value={reference.id}>{reference.reference_code}{reference.care_area ? " · " + reference.care_area : ""}</option>)}</select><small>Only active references from this hospital are available.</small></label>
            <label>Priority<select value={newPriority} onChange={event => setNewPriority(event.target.value as Priority)}>{validPriorities.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
            <label>Status<select value={newStatus} onChange={event => setNewStatus(event.target.value as WorkStatus)}>{validStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
            <label>External reference (optional)<input maxLength={120} value={newExternalReference} onChange={event => setNewExternalReference(event.target.value)} placeholder="Non-sensitive external ID" /></label>
            <label>Due date (optional)<input type="datetime-local" value={newDueAt} onChange={event => setNewDueAt(event.target.value)} /></label>
            <label className="full">Summary (optional)<textarea maxLength={2000} rows={3} value={newSummary} onChange={event => setNewSummary(event.target.value)} placeholder="Short operational context; avoid clinical details and direct identifiers." /></label>
            <div className="ops-queue-form-actions"><button type="button" className="ops-queue-secondary-button" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button><button type="submit" className="ops-queue-primary-button" disabled={saving}><Save size={15} />{saving ? "Saving…" : editingId ? "Save changes" : "Create record"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
