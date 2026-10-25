"use client";

import HospitalWorkspaceSwitcher from "@/components/hospital-workspace-switcher";
import { hospitalApiUrl } from "@/lib/client/hospital-workspace";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles, UserRound, XCircle } from "lucide-react";

type StaffMessage = { id: string; author_user_id: string; author_type: string; visibility: string; body: string; created_at: string };
type StaffAppointment = {
  id: string; status: string; start_at: string; end_at: string; location: string | null;
  patient_instructions: string | null; confirmed_at: string | null; created_at?: string;
};
type StaffWorkItem = { id: string; patient_request_id: string; reference_code: string; title: string; summary: string | null; item_type: string; priority: string; status: string; owner_id: string | null; due_at: string | null; created_at: string; updated_at: string };
type StaffAuditEvent = { id: number; actor_id: string | null; entity_type: string; entity_id: string; action: string; details: Record<string, unknown>; created_at: string };
type CoordinationEvent = { id: string; at: string; title: string; detail: string; kind: "request" | "message" | "task" | "audit" | "appointment" };
type StaffRequest = {
  id: string; request_code: string; hospital_id: string; patient_user_id: string; service_id: string | null;
  request_type: string; status: string; subject: string; preferred_start_at: string | null; preferred_end_at: string | null;
  submitted_at: string; created_at: string; closed_at: string | null;
  patient: { display_name: string; phone_number: string | null };
  service: { id: string; name: string; department: string | null } | null;
  appointment: StaffAppointment | null; messages: StaffMessage[]; workItems: StaffWorkItem[]; auditEvents: StaffAuditEvent[];
};
const statusLabel: Record<string, string> = {
  submitted: "New request", under_review: "Under review", awaiting_patient: "Awaiting patient",
  awaiting_hospital: "Awaiting hospital", appointment_proposed: "Appointment proposed",
  confirmed: "Confirmed", in_progress: "In progress", cancellation_requested: "Cancellation requested",
  completed: "Completed", no_show: "No-show", cancelled: "Cancelled", declined: "Declined",
};
const terminal = new Set(["completed", "no_show", "cancelled", "declined"]);
function formatDate(value: string | null | undefined, time = true) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-GB", time
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function coordinationGuidance(item: StaffRequest) {
  const tasks = item.workItems ?? [];
  const openTasks = tasks.filter(task => !["resolved", "closed"].includes(task.status));
  const overdue = openTasks.find(task => task.due_at && new Date(task.due_at).getTime() < Date.now());
  if (overdue) {
    return { title: "A linked work item is overdue", detail: `“${overdue.title}” passed its due time. Review ownership and agree the next operational step.`, tone: "urgent" as const };
  }
  if (terminal.has(item.status)) {
    return { title: "The request has reached an outcome", detail: "Check that linked work is resolved and the final patient update is recorded before treating the workflow as complete.", tone: "complete" as const };
  }
  if (item.status === "appointment_proposed") {
    return { title: "The next step sits with the patient", detail: "An appointment time has been proposed. Wait for the patient's response; the proposal is not a confirmed booking.", tone: "waiting" as const };
  }
  if (item.appointment?.status === "patient_accepted") {
    return { title: "Hospital confirmation is outstanding", detail: "The patient accepted the proposed time. An authorised staff member must confirm the appointment.", tone: "attention" as const };
  }
  if (item.status === "awaiting_patient") {
    return { title: "Patient information is outstanding", detail: "The hospital has requested information. Review the conversation before sending another follow-up.", tone: "waiting" as const };
  }
  if (["submitted", "awaiting_hospital"].includes(item.status)) {
    const waitingHours = (Date.now() - new Date(item.submitted_at).getTime()) / 3_600_000;
    if (waitingHours > 24) return { title: "A hospital response may be delayed", detail: "This request has been waiting for more than 24 hours. Review the queue, assign an owner and send a clear update.", tone: "urgent" as const };
    return { title: "Hospital review is the next step", detail: "Review the request, confirm which team should own it, and make the next action visible to the patient.", tone: "attention" as const };
  }
  if (openTasks.some(task => !task.owner_id)) {
    return { title: "A linked task needs an owner", detail: "At least one open work item is unassigned. Agree who is responsible before handing the request across teams.", tone: "attention" as const };
  }
  if (["confirmed", "in_progress"].includes(item.status)) {
    return { title: "Keep the work moving to an outcome", detail: "Check the linked operational work and record the final outcome when the responsible team has completed its step.", tone: "steady" as const };
  }
  return { title: "Keep the request and its work connected", detail: "Use the linked work items and conversation below as the shared context for the next handover.", tone: "steady" as const };
}

function coordinationTimeline(item: StaffRequest): CoordinationEvent[] {
  const events: CoordinationEvent[] = [{
    id: `request-${item.id}`, at: item.submitted_at, title: "Request received",
    detail: `Opened in Converge · ${item.request_code}`, kind: "request",
  }];
  for (const message of item.messages ?? []) {
    events.push({
      id: `message-${message.id}`, at: message.created_at,
      title: message.visibility === "internal" ? "Internal team note" : message.author_type === "patient" ? "Patient message" : message.author_type === "staff" ? "Hospital team update" : "System message",
      detail: message.body, kind: "message",
    });
  }
  for (const task of item.workItems ?? []) {
    events.push({
      id: `task-${task.id}`, at: task.created_at, title: `Work item linked · ${task.title}`,
      detail: `${task.item_type.replaceAll("_", " ")} · ${task.priority} priority · ${task.status.replaceAll("_", " ")}`, kind: "task",
    });
    if (task.updated_at && task.updated_at !== task.created_at) {
      events.push({
        id: `task-update-${task.id}`, at: task.updated_at, title: `Work item updated · ${task.title}`,
        detail: `Current state: ${task.status.replaceAll("_", " ")}`, kind: "task",
      });
    }
  }
  for (const event of item.auditEvents ?? []) {
    if (event.action === "patient_request_submitted") continue;
    events.push({
      id: `audit-${event.id}`, at: event.created_at,
      title: event.action.replaceAll("_", " "),
      detail: "Recorded in the hospital audit trail.", kind: "audit",
    });
  }
  if (item.appointment) {
    events.push({
      id: `appointment-${item.appointment.id}`,
      at: item.appointment.confirmed_at ?? item.appointment.created_at ?? item.submitted_at,
      title: `Appointment ${item.appointment.status.replaceAll("_", " ")}`,
      detail: `${formatDate(item.appointment.start_at)} – ${formatDate(item.appointment.end_at)}${item.appointment.location ? ` · ${item.appointment.location}` : ""}`,
      kind: "appointment",
    });
  }
  return events.filter(event => event.at && !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 14);
}

export default function HospitalRequestsPage() {
  const [hospital, setHospital] = useState<{ id: string; name: string; city: string | null; country: string } | null>(null);
  const [role, setRole] = useState("");
  const [requests, setRequests] = useState<StaffRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [showAskForm, setShowAskForm] = useState(false);
  const [askMessage, setAskMessage] = useState("");
  const [showProposal, setShowProposal] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");
  const [instructions, setInstructions] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch(hospitalApiUrl("/api/hospital/requests"), { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load patient requests.");
      setHospital(payload.hospital ?? null);
      setRole(payload.role ?? "");
      const rows = (payload.requests ?? []) as StaffRequest[];
      setRequests(rows);
      setSelectedId(current => rows.some(item => item.id === current) ? current : rows[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hospital requests.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // When an operator opens a linked access case, focus its canonical patient request.
  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get("requestId");
    if (!requestId || !requests.some(item => item.id === requestId)) return;
    setSelectedId(requestId);
    setFilter("all");
    setSearch("");
  }, [requests]);

  const visible = useMemo(() => requests.filter(item => {
    const matchesFilter = filter === "all"
      || (filter === "open" && !terminal.has(item.status))
      || (filter === "needs_response" && ["submitted", "awaiting_hospital", "cancellation_requested"].includes(item.status))
      || (filter === "appointments" && item.request_type === "appointment");
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [
      item.request_code, item.subject, item.patient.display_name, item.service?.name ?? "",
      item.hospital_id,
    ].some(value => value.toLowerCase().includes(term));
    return matchesFilter && matchesSearch;
  }), [requests, filter, search]);

  const selected = requests.find(item => item.id === selectedId) ?? null;
  const selectedGuidance = selected ? coordinationGuidance(selected) : null;
  const selectedTimeline = selected ? coordinationTimeline(selected) : [];
  const canManage = ["owner", "admin", "clinician", "operations"].includes(role);

  async function act(action: string, requestItem = selected, message = "", proposal?: { startAt: string; endAt: string; location: string; instructions: string }) {
    if (!hospital || !requestItem) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalId: hospital.id,
          requestId: requestItem.id,
          action,
          message,
          startAt: proposal ? toIso(proposal.startAt) : null,
          endAt: proposal ? toIso(proposal.endAt) : null,
          location: proposal?.location ?? "",
          instructions: proposal?.instructions ?? "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to complete this action.");
      setNotice("Request updated. The change and audit event were recorded together.");
      setShowAskForm(false); setAskMessage(""); setShowProposal(false); setDecisionMessage("");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete this action.");
    } finally {
      setBusy(false);
    }
  }

  async function copyHandover(item: StaffRequest) {
    const guidance = coordinationGuidance(item);
    const tasks = (item.workItems ?? []).map(task =>
      `- ${task.title} — ${task.status.replaceAll("_", " ")}; ${task.priority} priority; ${task.owner_id ? "assigned" : "unassigned"}${task.due_at ? `; due ${formatDate(task.due_at)}` : ""}`
    );
    const brief = [
      `CONVERGE HANDOVER — ${item.request_code}`,
      `Request: ${item.subject}`,
      `Service: ${item.service?.name ?? "Not specified"}${item.service?.department ? ` / ${item.service.department}` : ""}`,
      `Status: ${statusLabel[item.status] ?? item.status.replaceAll("_", " ")}`,
      `Coordination signal: ${guidance.title}`,
      guidance.detail,
      "Linked work:",
      ...(tasks.length ? tasks : ["- No linked work items found."]),
      `Appointment: ${item.appointment ? `${item.appointment.status.replaceAll("_", " ")} — ${formatDate(item.appointment.start_at)} to ${formatDate(item.appointment.end_at)}` : "None proposed"}`,
      "",
      "Operational handover only. Verify current context and permissions before taking action.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      setNotice("Handover brief copied. Review it before sharing with the receiving team.");
    } catch {
      setError("The handover brief could not be copied in this browser. You can review the coordination details on this page.");
    }
  }

  function submitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (askMessage.trim()) void act("ask_patient", selected, askMessage.trim());
  }
  function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startAt || !endAt) { setError("Choose an appointment start and end time."); return; }
    const start = toIso(startAt);
    const end = toIso(endAt);
    if (!start || !end || end <= start) { setError("The appointment end time must be after its start time."); return; }
    void act("propose_appointment", selected, decisionMessage, { startAt, endAt, location, instructions });
  }

  return (
    <main className="care-page hospital-requests-page">
      <header className="care-topbar">
        <Link href="/" className="care-brand"><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo care-converge-logo" /></Link>
        <nav className="care-header-actions"><Link href="/services" className="care-nav-link">Manage services</Link><Link href="/" className="care-nav-primary"><ArrowLeft size={15} /> Hospital workspace</Link></nav>
      </header>
      <HospitalWorkspaceSwitcher />

      <section className="care-workspace-heading">
        <Link href="/" className="care-back-link"><ArrowLeft size={14} /> Overview</Link>
        <span className="care-eyebrow">HOSPITAL OPERATIONS</span>
        <h1>Patient requests</h1>
        <p>{hospital ? hospital.name : "Review requests, coordinate next steps, and keep patients informed."} {hospital?.city ? "· " + hospital.city : ""}</p>
      </section>

      {error && <div className="care-alert error" role="alert">{error}<button onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div>}
      {notice && <div className="care-alert success" role="status"><CheckCircle2 size={16} />{notice}</div>}

      <div className="staff-request-metrics">
        <div><span>Open requests</span><strong>{requests.filter(item => !terminal.has(item.status)).length}</strong><small>Awaiting an outcome</small></div>
        <div><span>Need a response</span><strong>{requests.filter(item => ["submitted", "awaiting_hospital", "cancellation_requested"].includes(item.status)).length}</strong><small>Operational attention</small></div>
        <div><span>Appointment requests</span><strong>{requests.filter(item => item.request_type === "appointment" && !terminal.has(item.status)).length}</strong><small>Request, don&apos;t auto-book</small></div>
      </div>

      <div className="staff-requests-layout">
        <section className="staff-request-list-panel">
          <div className="staff-request-list-heading"><div><span className="care-eyebrow">INBOX</span><h2>Incoming work</h2></div><button className="care-icon-button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /></button></div>
          <label className="staff-request-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reference, patient, service" /></label>
          <div className="staff-request-filters">
            {[["open","Open"],["needs_response","Needs response"],["appointments","Appointments"],["all","All"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          {loading && <div className="care-loading"><span className="care-spinner" /> Loading requests…</div>}
          {!loading && visible.length === 0 && <div className="care-empty compact-empty"><div className="care-empty-mark"><MessageCircle size={20} /></div><h3>No requests in this view</h3><p>New patient submissions will appear here when they are received.</p></div>}
          <div className="staff-request-list">
            {visible.map(item => <button key={item.id} className={`staff-request-row ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setShowAskForm(false); setShowProposal(false); }}>
              <div className="staff-request-row-top"><strong>{item.request_code}</strong><span className={`care-status care-status-${item.status}`}>{statusLabel[item.status] ?? item.status.replaceAll("_"," ")}</span></div>
              <h3>{item.subject}</h3>
              <p>{item.patient.display_name} · {item.service?.name ?? "Service unavailable"}</p>
              <div className="staff-request-row-foot"><span>{item.request_type.replaceAll("_"," ")}</span><time>{formatDate(item.submitted_at, false)}</time></div>
            </button>)}
          </div>
        </section>

        <section className="staff-request-detail-panel">
          {!selected ? <div className="care-empty"><div className="care-empty-mark"><UserRound size={20} /></div><h3>Select a request</h3><p>Choose an item from the inbox to see its details and permitted actions.</p></div> : <>
            <div className="staff-detail-top"><div><span className="care-eyebrow">{selected.request_code}</span><h2>{selected.subject}</h2><p>{selected.service?.name ?? "Service"} · {selected.service?.department ?? "Department not specified"}</p></div><span className={`care-status care-status-${selected.status}`}>{statusLabel[selected.status] ?? selected.status}</span></div>
            <div className="staff-patient-summary"><div className="staff-patient-avatar"><UserRound size={19} /></div><div><strong>{selected.patient.display_name}</strong><span>{selected.patient.phone_number || "No phone number supplied"}</span><small>Patient account · reference {selected.request_code}</small></div></div>
            <div className="staff-detail-facts"><div><span>Submitted</span><strong>{formatDate(selected.submitted_at)}</strong></div><div><span>Request type</span><strong>{selected.request_type.replaceAll("_"," ")}</strong></div><div><span>Preferred time</span><strong>{selected.preferred_start_at ? formatDate(selected.preferred_start_at) : "Not specified"}</strong></div></div>
            <div className="staff-action-bar">
              {selected.status === "submitted" || selected.status === "awaiting_hospital" ? <button className="care-button-primary small" onClick={() => void act("start_review")} disabled={!canManage || busy}><CheckCircle2 size={14} /> Start review</button> : null}
              {["under_review","awaiting_hospital","appointment_proposed","awaiting_patient"].includes(selected.status) && !terminal.has(selected.status) ? <button className="care-button-secondary small" onClick={() => { setShowAskForm(value => !value); setShowProposal(false); }} disabled={!canManage || busy}><MessageCircle size={14} /> Request information</button> : null}
              {selected.request_type === "appointment" && !selected.appointment && ["under_review","awaiting_hospital","awaiting_patient"].includes(selected.status) ? <button className="care-button-primary small" onClick={() => { setShowProposal(value => !value); setShowAskForm(false); }} disabled={!canManage || busy}><CalendarClock size={14} /> Propose appointment</button> : null}
              {selected.appointment?.status === "patient_accepted" ? <button className="care-button-primary small" onClick={() => void act("confirm_appointment")} disabled={!canManage || busy}><CheckCircle2 size={14} /> Confirm appointment</button> : null}
              {selected.status === "cancellation_requested" ? <><button className="care-button-primary small" onClick={() => void act("approve_cancellation", selected, decisionMessage)} disabled={!canManage || busy}>Approve cancellation</button><button className="care-button-secondary small" onClick={() => void act("reject_cancellation", selected, decisionMessage)} disabled={!canManage || busy}>Decline cancellation</button></> : null}
              {(selected.status === "confirmed" || selected.status === "in_progress" || (selected.status === "under_review" && selected.request_type !== "appointment")) ? <button className="care-button-secondary small" onClick={() => void act("complete_request", selected, decisionMessage)} disabled={!canManage || busy}><CheckCircle2 size={14} /> Mark completed</button> : null}
              {["submitted","under_review","awaiting_hospital","awaiting_patient","appointment_proposed"].includes(selected.status) ? <button className="care-cancel-link" onClick={() => void act("decline_request", selected, decisionMessage)} disabled={!canManage || busy}><XCircle size={14} /> Decline request</button> : null}
            </div>

            {!canManage && <p className="care-privacy-note"><ShieldCheck size={14} /> Your current role is read-only for request actions.</p>}
            {selected.appointment && <div className="staff-appointment-detail"><div className="care-appointment-title"><CalendarClock size={16} /><strong>{selected.appointment.status.replaceAll("_"," ")}</strong></div><p>{formatDate(selected.appointment.start_at)} – {formatDate(selected.appointment.end_at)}</p>{selected.appointment.location && <span>{selected.appointment.location}</span>}{selected.appointment.patient_instructions && <p>{selected.appointment.patient_instructions}</p>}{selected.appointment.status === "proposed" && <small>Waiting for the patient to accept. The appointment is not confirmed.</small>}{selected.appointment.status === "patient_accepted" && <small>The patient accepted the proposal. Hospital confirmation is still required.</small>}</div>}

            {showAskForm && <form className="staff-action-form" onSubmit={submitAsk}><h3>Request information from the patient</h3><p>This message will be visible to the patient and move the request to “Awaiting patient”.</p><label>Message<textarea value={askMessage} onChange={event => setAskMessage(event.target.value)} rows={4} required maxLength={3000} placeholder="Explain what information is needed and why." /></label><div><button type="button" className="care-button-secondary small" onClick={() => setShowAskForm(false)}>Cancel</button><button type="submit" className="care-button-primary small" disabled={!canManage || busy || !askMessage.trim()}><Send size={14} /> Send request</button></div></form>}

            {showProposal && <form className="staff-action-form" onSubmit={submitProposal}><h3>Propose an appointment time</h3><p>This proposes a time for the patient to accept. It does not book the appointment yet.</p><div className="care-form-grid"><label>Start time<input type="datetime-local" required value={startAt} onChange={event => setStartAt(event.target.value)} /></label><label>End time<input type="datetime-local" required value={endAt} onChange={event => setEndAt(event.target.value)} /></label></div><label>Location <span className="care-optional">Optional</span><input value={location} onChange={event => setLocation(event.target.value)} maxLength={240} placeholder="e.g. Outpatient department" /></label><label>Patient instructions <span className="care-optional">Optional</span><textarea value={instructions} onChange={event => setInstructions(event.target.value)} rows={2} maxLength={1200} placeholder="Arrival guidance or documents to bring." /></label><label>Additional message <span className="care-optional">Optional</span><textarea value={decisionMessage} onChange={event => setDecisionMessage(event.target.value)} rows={2} maxLength={1000} placeholder="Any additional context." /></label><div><button type="button" className="care-button-secondary small" onClick={() => setShowProposal(false)}>Cancel</button><button type="submit" className="care-button-primary small" disabled={!canManage || busy}><CalendarClock size={14} /> Send proposal</button></div></form>}

            {!showProposal && !showAskForm && <label className="staff-decision-note">Optional patient-visible note for completion or cancellation decisions<textarea value={decisionMessage} onChange={event => setDecisionMessage(event.target.value)} rows={2} maxLength={2000} placeholder="Add a concise explanation if needed." /></label>}


            <section className="coordination-room" aria-label="Coordination room">
              <div className="coordination-room-heading">
                <div className="coordination-room-title">
                  <span className="coordination-room-mark"><Activity size={17} /></span>
                  <div><span className="care-eyebrow">CONVERGE COORDINATION ROOM</span><h3>One shared picture of this request</h3><p>Conversation, linked work and recorded decisions in one operational view.</p></div>
                </div>
                <button type="button" className="coordination-copy-button" onClick={() => void copyHandover(selected)}><ClipboardList size={15} /> Copy handover brief</button>
              </div>

              {selectedGuidance && <div className={`coordination-signal coordination-signal-${selectedGuidance.tone}`}>
                <span className="coordination-signal-icon"><Sparkles size={17} /></span>
                <div><div className="coordination-signal-label">NEXT COORDINATION STEP <span>Workflow-based guidance</span></div><h4>{selectedGuidance.title}</h4><p>{selectedGuidance.detail}</p></div>
              </div>}

              <div className="coordination-room-grid">
                <section className="coordination-work-panel">
                  <div className="coordination-section-heading"><div><span className="care-eyebrow">CONNECTED WORK</span><h4>Linked operational items</h4></div><span>{(selected.workItems ?? []).length}</span></div>
                  {(selected.workItems ?? []).length === 0 ? <div className="coordination-empty"><ClipboardList size={17} /><span>No linked work items were returned for this request.</span></div> :
                    <div className="coordination-work-list">{selected.workItems.map(task => <article key={task.id} className="coordination-work-item">
                      <div className="coordination-work-item-icon"><ClipboardList size={15} /></div>
                      <div className="coordination-work-item-main"><strong>{task.title}</strong><span>{task.reference_code} · {task.item_type.replaceAll("_", " ")}</span><div className="coordination-work-meta"><span className={`coordination-priority priority-${task.priority}`}>{task.priority} priority</span><span>{task.status.replaceAll("_", " ")}</span>{task.owner_id ? <span>Owner assigned</span> : <span className="coordination-unassigned">Unassigned</span>}</div>{task.due_at && <small className={new Date(task.due_at).getTime() < Date.now() && !["resolved","closed"].includes(task.status) ? "coordination-overdue" : ""}><Clock3 size={12} /> Due {formatDate(task.due_at)}</small>}</div>
                      <Link href={`/work?type=${encodeURIComponent(task.item_type)}`} className="coordination-work-open" aria-label={`Open ${task.title} work queue`}><ArrowRight size={15} /></Link>
                    </article>)}</div>}
                </section>

                <section className="coordination-timeline-panel">
                  <div className="coordination-section-heading"><div><span className="care-eyebrow">SHARED TIMELINE</span><h4>What has happened</h4></div><span>{selectedTimeline.length}</span></div>
                  {selectedTimeline.length === 0 ? <p className="care-muted-copy">No workflow events are available yet.</p> : <div className="coordination-timeline">{selectedTimeline.map(event => <article className={`coordination-timeline-event event-${event.kind}`} key={event.id}>
                    <span className="coordination-timeline-dot" />
                    <div className="coordination-timeline-content"><div className="coordination-event-heading"><strong>{event.title}</strong><time>{formatDate(event.at)}</time></div><p>{event.detail}</p></div>
                  </article>)}</div>}
                </section>
              </div>
              <p className="coordination-room-footnote"><ShieldCheck size={13} /> Guidance is derived from workflow state, not clinical judgment. Staff remain responsible for decisions and handovers.</p>
            </section>

            <div className="staff-thread-section"><div className="staff-thread-heading"><div><span className="care-eyebrow">REQUEST HISTORY</span><h3>Conversation and updates</h3></div><span>{selected.messages.length} message(s)</span></div>
              {selected.messages.length === 0 && <p className="care-muted-copy">No messages have been exchanged yet.</p>}
              {selected.messages.map(message => <article className="staff-thread-message" key={message.id}><div><strong>{message.author_type === "patient" ? "Patient" : message.author_type === "staff" ? "Hospital team" : "System"}{message.visibility === "internal" ? " · Internal note" : ""}</strong><time>{formatDate(message.created_at)}</time></div><p>{message.body}</p></article>)}
            </div>
          </>}
        </section>
      </div>

      <footer className="care-footer"><Link href="/" className="care-brand compact"><img src="/converge-logo.svg" alt="Converge" className="converge-logo care-converge-logo care-footer-logo" /></Link><span>Patient requests are operational records; clinical decisions remain with authorised professionals.</span><Link href="/audit">Audit history <ArrowRight size={13} /></Link></footer>
    </main>
  );
}
