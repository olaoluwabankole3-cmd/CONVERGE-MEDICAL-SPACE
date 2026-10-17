"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown,
  Clock3, FileClock, LayoutDashboard, LogOut, Search, Settings2, ShieldCheck,
  Stethoscope, Users, WandSparkles, X, ClipboardList, RefreshCw
} from "lucide-react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkType = "access_case" | "appointment" | "follow_up" | "exception" | "task";
type WorkStatus = "draft" | "open" | "needs_review" | "in_progress" | "awaiting_response" | "resolved" | "closed";
type Priority = "low" | "medium" | "high" | "urgent";
type Hospital = { id: string; name: string; status: "pending" | "active" | "rejected" | "suspended"; city: string | null; country: string; contact_email: string };
type DbWorkItem = {
  id: string; hospital_id: string; reference_code: string; title: string; summary: string | null;
  item_type: WorkType; priority: Priority; status: WorkStatus; owner_id: string | null;
  external_reference: string | null; due_at: string | null; created_at: string; updated_at: string;
};
type WorkItem = DbWorkItem & { owner: string; typeLabel: string; statusLabel: string; tone: string; priorityLabel: string };
type AuditEvent = { id: number; entity_type: string; entity_id: string; action: string; details: Record<string, unknown>; created_at: string };

const TYPE_LABELS: Record<WorkType, string> = { access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task" };
const STATUS_LABELS: Record<WorkStatus, string> = { draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress", awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed" };
const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const STATUS_TONES: Record<WorkStatus, string> = { draft: "blue", open: "blue", needs_review: "rose", in_progress: "violet", awaiting_response: "amber", resolved: "blue", closed: "blue" };
const ALLOWED_STATUSES: WorkStatus[] = ["open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed"];

function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
function mapItem(item: DbWorkItem): WorkItem {
  return { ...item, owner: item.owner_id ? "Assigned staff member" : "Unassigned", typeLabel: TYPE_LABELS[item.item_type], statusLabel: STATUS_LABELS[item.status], tone: STATUS_TONES[item.status], priorityLabel: PRIORITY_LABELS[item.priority] };
}

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [role, setRole] = useState("member");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState("All items");
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editExternalReference, setEditExternalReference] = useState("");
  const [editType, setEditType] = useState<WorkType>("access_case");
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newReference, setNewReference] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newExternalReference, setNewExternalReference] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newType, setNewType] = useState<WorkType>("access_case");
  const [newPriority, setNewPriority] = useState<Priority>("medium");

  const loadWorkspace = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        router.replace("/login");
        return;
      }
      const user = authData.user;
      setUserId(user.id);
      setUserEmail(user.email ?? "");

      // Resolve an active membership first so users who belong to an existing
      // hospital are not sent to an unrelated pending registration they created.
      // RLS only exposes active memberships; the creator lookup below handles
      // the owner's pending/rejected registration state.
      let selectedHospital: Hospital | null = null;
      let membershipRole = "owner";
      let hasActiveMembership = false;

      const { data: memberships, error: membershipError } = await supabase
        .from("hospital_memberships")
        .select("hospital_id,role,created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (membershipError) throw membershipError;

      const membership = memberships?.[0];
      if (membership) {
        membershipRole = membership.role;
        const { data: memberHospital, error: hospitalError } = await supabase
          .from("hospitals")
          .select("id,name,status,city,country,contact_email")
          .eq("id", membership.hospital_id)
          .maybeSingle();
        if (hospitalError) throw hospitalError;
        selectedHospital = memberHospital as Hospital | null;
        hasActiveMembership = selectedHospital?.status === "active";
      } else {
        const { data: ownedHospital, error: ownedError } = await supabase
          .from("hospitals")
          .select("id,name,status,city,country,contact_email")
          .eq("created_by", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ownedError) throw ownedError;
        selectedHospital = ownedHospital as Hospital | null;
      }

      setHospital(selectedHospital);
      setRole(membershipRole);
      if (!selectedHospital || selectedHospital.status !== "active") {
        setItems([]);
        setAuditEvents([]);
        setSelected(null);
        setLoading(false);
        return;
      }
      if (!hasActiveMembership) {
        throw new Error("This hospital is active, but your membership could not be verified. Please contact your hospital administrator before accessing operational records.");
      }

      const { data, error: itemsError } = await supabase
        .from("work_items")
        .select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at")
        .eq("hospital_id", selectedHospital.id)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (itemsError) throw itemsError;
      const mapped = ((data ?? []) as DbWorkItem[]).map(mapItem);
      setItems(mapped);
      const { data: events, error: eventsError } = await supabase.from("audit_events").select("id,entity_type,entity_id,action,details,created_at").eq("hospital_id", selectedHospital.id).order("created_at", { ascending: false }).limit(8);
      if (eventsError) throw eventsError;
      setAuditEvents((events ?? []) as AuditEvent[]);
      setSelected((current) => current ? mapped.find((item) => item.id === current.id) ?? null : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your hospital workspace.");
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesFilter = filter === "All items" || (filter === "Unassigned" ? !item.owner_id : item.owner_id === userId);
    const query = search.toLowerCase().trim();
    const matchesSearch = !query || [item.reference_code, item.title, item.external_reference ?? "", item.typeLabel, item.owner, item.statusLabel].some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  }), [items, filter, search, userId]);

  const metrics = useMemo(() => [
    { label: "Open access cases", value: items.filter(i => i.item_type === "access_case" && !["resolved", "closed"].includes(i.status)).length, note: `${items.filter(i => i.item_type === "access_case" && ["needs_review", "awaiting_response"].includes(i.status)).length} need attention`, icon: Users, tone: "blue" },
    { label: "Appointments", value: items.filter(i => i.item_type === "appointment" && !["resolved", "closed"].includes(i.status)).length, note: "Open appointment work items", icon: CalendarDays, tone: "violet" },
    { label: "Follow-ups due", value: items.filter(i => i.item_type === "follow_up" && !["resolved", "closed"].includes(i.status)).length, note: `${items.filter(i => i.item_type === "follow_up" && i.due_at && new Date(i.due_at) < new Date() && !["resolved", "closed"].includes(i.status)).length} overdue`, icon: Clock3, tone: "amber" },
    { label: "Open exceptions", value: items.filter(i => i.item_type === "exception" && !["resolved", "closed"].includes(i.status)).length, note: `${items.filter(i => i.item_type === "exception" && ["high", "urgent"].includes(i.priority) && !["resolved", "closed"].includes(i.status)).length} high priority`, icon: AlertCircle, tone: "rose" }
  ], [items]);

  async function createWorkItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !hospital || !userId || hospital.status !== "active") return;
    setSaving(true); setError(""); setNotice("");
    const prefix: Record<WorkType, string> = { access_case: "AC", appointment: "AP", follow_up: "FU", exception: "EX", task: "TK" };
    const referenceCode = newReference.trim() || `${prefix[newType]}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    try {
      const { data, error: insertError } = await supabase.from("work_items").insert({
        hospital_id: hospital.id, reference_code: referenceCode, title: newTitle.trim(),
        summary: newSummary.trim() || null, item_type: newType, priority: newPriority,
        status: "open", external_reference: newExternalReference.trim() || null,
        due_at: newDueDate ? new Date(`${newDueDate}T23:59:00`).toISOString() : null, created_by: userId
      }).select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at").single();
      if (insertError) throw insertError;
      await supabase.from("audit_events").insert({ hospital_id: hospital.id, actor_id: userId, entity_type: "work_item", entity_id: data.id, action: "created", details: { reference_code: referenceCode, item_type: newType } });
      const mapped = mapItem(data as DbWorkItem);
      setItems(current => [mapped, ...current]);
      setSelected(mapped); setFilter("All items"); setSearch("");
      setNewTitle(""); setNewReference(""); setNewSummary(""); setNewExternalReference(""); setNewDueDate(""); setNewType("access_case"); setNewPriority("medium"); setShowCreate(false);
      setNotice(`${mapped.reference_code} was saved to the hospital workspace.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this work item. Check your hospital access and try again.");
    } finally { setSaving(false); }
  }

  async function updateStatus(nextStatus: WorkStatus) {
    if (!supabase || !hospital || !selected || hospital.status !== "active") return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items")
        .update({ status: nextStatus })
        .eq("id", selected.id).eq("hospital_id", hospital.id)
        .select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at").single();
      if (updateError) throw updateError;
      await supabase.from("audit_events").insert({ hospital_id: hospital.id, actor_id: userId, entity_type: "work_item", entity_id: selected.id, action: "status_changed", details: { status: nextStatus, reference_code: selected.reference_code } });
      const mapped = mapItem(data as DbWorkItem);
      setItems(current => current.map(item => item.id === mapped.id ? mapped : item));
      setSelected(mapped);
      setNotice(`${mapped.reference_code} updated to ${mapped.statusLabel.toLowerCase()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the work item.");
    } finally { setSaving(false); }
  }

  function openEditItem() {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditSummary(selected.summary ?? "");
    setEditReference(selected.reference_code);
    setEditExternalReference(selected.external_reference ?? "");
    setEditType(selected.item_type);
    setEditPriority(selected.priority);
    setShowEdit(true);
  }

  async function saveEditedItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !hospital || !selected || hospital.status !== "active") return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("work_items")
        .update({
          title: editTitle.trim(), summary: editSummary.trim() || null,
          reference_code: editReference.trim(), external_reference: editExternalReference.trim() || null,
          item_type: editType, priority: editPriority,
        })
        .eq("id", selected.id).eq("hospital_id", hospital.id)
        .select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at").single();
      if (updateError) throw updateError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospital.id, actor_id: userId, entity_type: "work_item", entity_id: selected.id,
        action: "work_item_updated", details: { reference_code: editReference.trim(), item_type: editType, priority: editPriority },
      });
      const mapped = mapItem(data as DbWorkItem);
      setItems(current => current.map(item => item.id === mapped.id ? mapped : item));
      setSelected(mapped); setShowEdit(false);
      setNotice(auditError ? "Work item saved, but the audit event could not be recorded." : `${mapped.reference_code} details were updated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save work item changes. The reference code may already be in use.");
    } finally { setSaving(false); }
  }

  async function updateDueDate(value: string) {
    if (!supabase || !hospital || !selected || hospital.status !== "active") return;
    setSaving(true); setError(""); setNotice("");
    try {
      const dueAt = value ? new Date(`${value}T23:59:00`).toISOString() : null;
      const { data, error: updateError } = await supabase.from("work_items")
        .update({ due_at: dueAt })
        .eq("id", selected.id).eq("hospital_id", hospital.id)
        .select("id,hospital_id,reference_code,title,summary,item_type,priority,status,owner_id,external_reference,due_at,created_at,updated_at").single();
      if (updateError) throw updateError;
      const { error: auditError } = await supabase.from("audit_events").insert({
        hospital_id: hospital.id, actor_id: userId, entity_type: "work_item", entity_id: selected.id,
        action: "due_date_changed", details: { due_at: dueAt, reference_code: selected.reference_code }
      });
      const mapped = mapItem(data as DbWorkItem);
      setItems(current => current.map(item => item.id === mapped.id ? mapped : item));
      setSelected(mapped);
      setNotice(auditError ? "Due date saved. The audit event could not be recorded." : `${mapped.reference_code} due date updated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the due date.");
    } finally { setSaving(false); }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  const activeCount = items.filter(i => !["resolved", "closed"].includes(i.status)).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Activity size={21} strokeWidth={2.4} /></div><div><strong>converge</strong><span>MEDICAL INTELLIGENCE</span></div></div>
        <div className="workspace-switcher"><div className="hospital-mark"><Stethoscope size={18} /></div><div className="workspace-copy"><strong>{hospital?.name ?? "Hospital workspace"}</strong><span>{hospital?.status === "active" ? `${hospital.city ? hospital.city + ", " : ""}${hospital.country}` : hospital?.status === "pending" ? "Awaiting approval" : "No workspace connected"}</span></div><ChevronDown size={16} className="muted-icon" /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#"><LayoutDashboard size={18} /><span>Overview</span><i className="active-dot" /></a>
          <a className="nav-item" href="#work"><Users size={18} /><span>Access cases</span><b className="nav-count">{items.filter(i => i.item_type === "access_case" && !["resolved", "closed"].includes(i.status)).length}</b></a>
          <a className="nav-item" href="/patients"><Users size={18} /><span>Patient references</span></a><a className="nav-item" href="#work"><CalendarDays size={18} /><span>Appointments</span></a>
          <a className="nav-item" href="#work"><CheckCircle2 size={18} /><span>Follow-ups & tasks</span></a>
          <a className="nav-item" href="#attention"><AlertCircle size={18} /><span>Exceptions</span><b className="nav-count warning">{items.filter(i => i.item_type === "exception" && !["resolved", "closed"].includes(i.status)).length}</b></a>
        </nav>
        <div className="nav-label">GOVERNANCE</div>
        <nav className="nav-list" aria-label="Governance navigation">
          <a className="nav-item" href="#ai"><WandSparkles size={18} /><span>AI agents</span></a>
          <a className="nav-item" href="#attention"><ShieldCheck size={18} /><span>Approvals</span></a>
          <a className="nav-item" href="#activity"><FileClock size={18} /><span>Audit history</span></a>
          <a className="nav-item" href="/reports"><Activity size={18} /><span>Reports & analytics</span></a>
        </nav>
        <div className="sidebar-bottom"><a className="nav-item" href="/team"><Settings2 size={18} /><span>Team & access</span></a><a className="nav-item" href="/settings"><Stethoscope size={18} /><span>Hospital settings</span></a><div className="profile"><div className="avatar">{(userEmail.split("@")[0] || "U").slice(0, 2).toUpperCase()}</div><div className="profile-copy"><strong>{userEmail || "Signed-in user"}</strong><span>{role.replace("_", " ")} · workspace access</span></div><button className="icon-button subtle" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></div></div>
      </aside>

      <section className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div><div className="topbar-actions"><div className="demo-badge"><span /> {hospital?.status === "active" ? "Live workspace" : "Setup required"}</div><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work items" aria-label="Search work items" /></label><button className="dashboard-signin" onClick={() => void loadWorkspace()} disabled={loading}><RefreshCw size={14} /> Refresh</button></div></header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date()).toUpperCase()} <span className="eyebrow-line" /></div><h1>{hospital?.status === "active" ? "Your operations, at a glance." : "Set up your hospital workspace."}</h1><p>{hospital?.status === "active" ? "A live view of the operational work your team is coordinating." : "Complete the hospital approval process to begin managing operational work."}</p></div><button className="primary-button" onClick={() => setShowCreate(true)} disabled={!hospital || hospital.status !== "active"}><span>+</span> Create work item</button></div>
          {error && <div className="notice error-notice"><div className="notice-icon"><AlertCircle size={19} /></div><div><strong>Something needs attention</strong><p>{error}</p></div><button className="notice-dismiss" onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
          {notice && <div className="notice"><div className="notice-icon"><CheckCircle2 size={19} /></div><div><strong>Saved successfully</strong><p>{notice}</p></div><button className="notice-dismiss" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={16} /></button></div>}
          {!loading && (!hospital || hospital.status !== "active") && <section className="panel onboarding-state"><div className="notice-icon"><ShieldCheck size={22} /></div><div><h2>{!hospital ? "No hospital workspace found" : hospital.status === "pending" ? "Hospital registration awaiting approval" : hospital.status === "rejected" ? "Hospital registration was not approved" : "Hospital workspace is suspended"}</h2><p>{!hospital ? "Sign in and register your hospital before creating operational records." : hospital.status === "pending" ? "Your registration has been received. The workspace will become available after an authorised administrator approves it." : hospital.status === "rejected" ? "Please contact the platform administrator for the next steps." : "This workspace is not currently available. Contact the platform administrator."}</p><div className="onboarding-actions">{!hospital && <button className="primary-button" onClick={() => router.push("/onboarding")}>Register hospital <ArrowRight size={15} /></button>}<button className="secondary-button" onClick={signOut}>Sign out</button></div></div></section>}
          <section className="metrics-grid" aria-label="Operational summary">{metrics.map((metric) => { const Icon = metric.icon; return <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><div className={`metric-icon ${metric.tone}`}><Icon size={18} /></div></div><div className="metric-value">{loading ? "—" : metric.value}</div><div className={`metric-delta ${metric.tone}`}>{metric.note}</div></article>; })}</section>
          <div className="content-grid">
            <section className="panel work-panel" id="work">
              <div className="panel-heading"><div><h2>Operational work queue</h2><p>Persisted work items in your authorised hospital workspace</p></div><button className="text-button" onClick={() => { setFilter("All items"); setSearch(""); }}>Reset view <ArrowRight size={15} /></button></div>
              <div className="work-filters">{["All items", "Assigned to me", "Unassigned"].map((value) => <button key={value} className={`filter ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>{value}<span>{value === "All items" ? items.length : value === "Unassigned" ? items.filter(i => !i.owner_id).length : items.filter(i => i.owner_id === userId).length}</span></button>)}</div>
              <div className="table-wrap"><table><thead><tr><th>ITEM</th><th>TYPE</th><th>OWNER</th><th>PRIORITY</th><th>STATUS</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className={selected?.id === item.id ? "selected-row" : ""} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(item); }}><td><div className="item-title">{item.title}</div><div className="item-sub">{item.reference_code} · {item.external_reference ? "External reference supplied" : "No external reference"}</div></td><td><span className="type-label">{item.typeLabel}</span></td><td><span className={!item.owner_id ? "unassigned" : "owner"}>{item.owner}</span></td><td><span className={`priority priority-${item.priority}`}><i />{item.priorityLabel}</span></td><td><Pill tone={item.tone}>{item.statusLabel}</Pill></td></tr>)}</tbody></table>{loading && <div className="empty-state">Loading authorised work items…</div>}{!loading && hospital?.status === "active" && visibleItems.length === 0 && <div className="empty-state">{items.length ? "No work items match this view." : "No operational work items yet. Create the first item to get started."}</div>}</div>
              <div className="panel-footer"><span>Showing {visibleItems.length} of {items.length} saved work items</span><button className="text-button" onClick={() => void loadWorkspace()}>Refresh queue <ArrowRight size={15} /></button></div>
            </section>
            <aside className="right-column">
              {selected && <section className="panel details-panel"><div className="panel-heading"><div><h2>Selected item</h2><p>Contextual record details</p></div><div style={{ display: "flex", gap: 6 }}><button className="text-button" onClick={openEditItem} disabled={saving}>Edit</button><button className="icon-button subtle" onClick={() => setSelected(null)} aria-label="Close selected item"><X size={16} /></button></div></div><div className="detail-body"><Pill tone={selected.tone}>{selected.statusLabel}</Pill><h3>{selected.title}</h3><p className="detail-reference">{selected.reference_code} · Created {formatDate(selected.created_at)}</p>{selected.summary && <p className="detail-summary">{selected.summary}</p>}<dl><div><dt>Work type</dt><dd>{selected.typeLabel}</dd></div><div><dt>Owner</dt><dd>{selected.owner}</dd></div><div><dt>Priority</dt><dd>{selected.priorityLabel}</dd></div><div><dt>Due date</dt><dd>{selected.due_at ? formatDate(selected.due_at) : "No due date"}</dd></div><div><dt>External reference</dt><dd>{selected.external_reference || "Not supplied"}</dd></div><div><dt>Last updated</dt><dd>{formatDate(selected.updated_at)}</dd></div></dl><label className="status-field">Update due date<input type="date" value={selected.due_at ? new Date(selected.due_at).toISOString().slice(0, 10) : ""} disabled={saving} onChange={(e) => void updateDueDate(e.target.value)} /></label><label className="status-field">Update status<select value={selected.status} disabled={saving} onChange={(e) => void updateStatus(e.target.value as WorkStatus)}>{(["draft", ...ALLOWED_STATUSES] as WorkStatus[]).map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label><p className="detail-note">Keep references operational and minimal. Do not store unnecessary patient-identifying information in work-item titles or summaries.</p></div></section>}
              <section className="panel focus-panel" id="attention"><div className="panel-heading"><div><h2>Needs attention</h2><p>Calculated from saved work items</p></div><span className="attention-count">{items.filter(i => ["needs_review", "awaiting_response"].includes(i.status) && !["resolved", "closed"].includes(i.status)).length}</span></div><div className="attention-item"><div className="attention-symbol rose"><AlertCircle size={17} /></div><div><strong>High-priority exceptions</strong><p>{items.filter(i => i.item_type === "exception" && ["high", "urgent"].includes(i.priority) && !["resolved", "closed"].includes(i.status)).length} open exception(s) need operational review</p><button className="inline-link" onClick={() => { setFilter("All items"); setSearch("EX-"); }}>Review exceptions <ArrowRight size={13} /></button></div></div><div className="attention-item"><div className="attention-symbol amber"><Clock3 size={17} /></div><div><strong>Overdue follow-ups</strong><p>{items.filter(i => i.item_type === "follow_up" && i.due_at && new Date(i.due_at) < new Date() && !["resolved", "closed"].includes(i.status)).length} follow-up(s) past due</p><button className="inline-link" onClick={() => { setFilter("All items"); setSearch("follow-up"); }}>Review follow-ups <ArrowRight size={13} /></button></div></div><div className="attention-item"><div className="attention-symbol violet"><ShieldCheck size={17} /></div><div><strong>Workspace access</strong><p>{hospital?.status === "active" ? `Hospital active · role: ${role}` : "Hospital approval is required before operations can begin."}</p><button className="inline-link" onClick={() => router.push("/onboarding")}>Workspace details <ArrowRight size={13} /></button></div></div></section>
              <section className="panel activity-panel" id="activity"><div className="panel-heading"><div><h2>Recent activity</h2><p>Recorded workspace events</p></div><button className="icon-button subtle" onClick={() => void loadWorkspace()} aria-label="Refresh activity"><RefreshCw size={15} /></button></div><div className="activity-list">{auditEvents.map(event => { const details = event.details ?? {}; const reference = typeof details.reference_code === "string" ? details.reference_code : event.entity_id.slice(0, 8); const actionLabel = event.action === "status_changed" ? "Status changed" : event.action === "created" ? "Work item created" : event.action.replaceAll("_", " "); return <div className="activity-entry" key={event.id}><div className="activity-icon"><ClipboardList size={16} /></div><div className="activity-copy"><strong>{reference} · {actionLabel}</strong><p>{event.entity_type.replaceAll("_", " ")} · recorded event</p><span>{formatDate(event.created_at)} · {new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></div></div>; })}{!loading && auditEvents.length === 0 && <div className="empty-state">No audit events have been recorded yet.</div>}</div><button className="text-button activity-link" onClick={() => void loadWorkspace()}>Refresh audit events <ArrowRight size={15} /></button></section>
              <section className="ai-card" id="ai"><div className="ai-card-top"><div className="ai-mark"><WandSparkles size={19} /></div><Pill tone="violet">Governed AI</Pill></div><h2>AI support, with oversight.</h2><p>AI features are not enabled yet. The next milestone adds evidence-linked operational assistance with human approval controls.</p><button className="ai-link" onClick={() => setNotice("AI agent registry is planned after the core operational workflows and access controls are verified.")}>Explore AI roadmap <ArrowRight size={15} /></button></section>
            </aside>
          </div>
          <footer className="page-footer"><span><i className="footer-dot" /> {loading ? "Connecting to workspace…" : hospital?.status === "active" ? "Connected to Supabase" : "Workspace setup incomplete"}</span><span>Converge Medical Intelligence <b>·</b> {activeCount} open item(s)</span></footer>
        </div>
      </section>
      {showEdit && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowEdit(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-heading"><div><span className="modal-kicker">HOSPITAL WORKSPACE</span><h2 id="edit-title">Edit work item</h2><p>Changes are saved to this hospital’s operational queue.</p></div><button className="icon-button" onClick={() => setShowEdit(false)} aria-label="Close dialog" disabled={saving}><X size={17} /></button></div><form onSubmit={saveEditedItem}><label>Work item title<input required minLength={3} maxLength={240} value={editTitle} onChange={e => setEditTitle(e.target.value)} /></label><label>Reference code<input required minLength={2} maxLength={80} value={editReference} onChange={e => setEditReference(e.target.value)} /></label><label>Work type<select value={editType} onChange={e => setEditType(e.target.value as WorkType)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Priority<select value={editPriority} onChange={e => setEditPriority(e.target.value as Priority)}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>External reference (optional)<input maxLength={120} value={editExternalReference} onChange={e => setEditExternalReference(e.target.value)} /></label><label>Operational summary (optional)<textarea maxLength={1000} rows={3} value={editSummary} onChange={e => setEditSummary(e.target.value)} placeholder="Avoid unnecessary patient-identifying details." /></label><div className="form-note"><ShieldCheck size={16} /> Changes are recorded in the audit history. Do not include unnecessary patient-identifying information.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowEdit(false)} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save changes"} <ArrowRight size={15} /></button></div></form></section></div>}
      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowCreate(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><span className="modal-kicker">HOSPITAL WORKSPACE</span><h2 id="create-title">Create work item</h2><p>Saved to Supabase and scoped to the active hospital.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close dialog" disabled={saving}><X size={17} /></button></div><form onSubmit={createWorkItem}><label>Work item title<input required minLength={3} maxLength={240} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Referral documentation requires review" autoFocus /></label><label>Work type<select value={newType} onChange={(e) => setNewType(e.target.value as WorkType)}><option value="access_case">Access case</option><option value="appointment">Appointment</option><option value="follow_up">Follow-up</option><option value="exception">Exception</option><option value="task">Task</option></select></label><label>Priority<select value={newPriority} onChange={(e) => setNewPriority(e.target.value as Priority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Reference code (optional)<input maxLength={80} value={newReference} onChange={(e) => setNewReference(e.target.value)} placeholder="e.g. AC-2048 (no patient name)" /></label><label>External reference (optional)<input maxLength={120} value={newExternalReference} onChange={(e) => setNewExternalReference(e.target.value)} placeholder="Internal ticket or referral reference" /></label><label>Due date (optional)<input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} /></label><label>Operational summary (optional)<textarea maxLength={1000} value={newSummary} onChange={(e) => setNewSummary(e.target.value)} placeholder="Brief operational context. Avoid unnecessary patient-identifying details." rows={3} /></label><div className="form-note"><ShieldCheck size={16} /> This creates a persistent operational record. Do not enter names, diagnoses, or other unnecessary sensitive patient information.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save work item"} <ArrowRight size={15} /></button></div></form></section></div>}
    </main>
  );
}
