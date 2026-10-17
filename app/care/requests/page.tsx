"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";

type Service = {
  id: string; name: string; description: string | null; department: string | null;
  hospital: { id: string; name: string; city: string | null; country: string } | null;
};
type Message = { id: string; author_type: "patient" | "staff" | "system"; body: string; created_at: string };
type Appointment = {
  id: string; status: string; start_at: string; end_at: string; location: string | null;
  patient_instructions: string | null; confirmed_at: string | null;
};
type PatientRequest = {
  id: string; request_code: string; hospital_id: string; service_id: string | null;
  request_type: string; status: string; subject: string; preferred_start_at: string | null;
  preferred_end_at: string | null; submitted_at: string; created_at: string;
  service: { id: string; name: string; department: string | null } | null;
  hospital: { id: string; name: string; city: string | null; country: string } | null;
  appointment: Appointment | null; messages: Message[];
};

const statusLabel: Record<string, string> = {
  submitted: "Received", under_review: "Under review", awaiting_patient: "Your response needed",
  awaiting_hospital: "Awaiting hospital", appointment_proposed: "Appointment proposed",
  confirmed: "Confirmed", in_progress: "In progress", cancellation_requested: "Cancellation under review",
  completed: "Completed", no_show: "No-show", cancelled: "Cancelled", declined: "Declined",
};
const terminal = new Set(["completed", "no_show", "cancelled", "declined"]);

function formatDate(value: string | null | undefined, withTime = true) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-GB", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function localIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function PatientRequestsPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [requests, setRequests] = useState<PatientRequest[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [requestType, setRequestType] = useState("appointment");
  const [subject, setSubject] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [patientMessage, setPatientMessage] = useState("");
  const [preferredStartAt, setPreferredStartAt] = useState("");
  const [preferredEndAt, setPreferredEndAt] = useState("");
  const [replyById, setReplyById] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const directoryPromise = fetch("/api/patient/services", { cache: "no-store" }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load the service directory.");
        return payload.services as Service[];
      });
      const requestResponsePromise = fetch("/api/patient/requests", { cache: "no-store" });
      const available = await directoryPromise;
      setServices(available);
      const params = new URLSearchParams(window.location.search);
      const queryService = params.get("serviceId") ?? "";
      const queryHospital = params.get("hospitalId") ?? "";
      const preferredService = queryService && available.some(item => item.id === queryService)
        ? queryService
        : available.find(item => item.hospital?.id === queryHospital)?.id ?? available[0]?.id ?? "";
      setServiceId(current => current || preferredService);
      const requestResponse = await requestResponsePromise;
      const payload = await requestResponse.json();
      if (requestResponse.status === 401) {
        setNeedsLogin(true);
        setRequests([]);
        return;
      }
      if (!requestResponse.ok) throw new Error(payload.error ?? "Unable to load your requests.");
      setNeedsLogin(false);
      setEmail(payload.email ?? "");
      setRequests(payload.requests ?? []);
      if (payload.profile) {
        setDisplayName(current => current || payload.profile.display_name || "");
        setPhoneNumber(current => current || payload.profile.phone_number || "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your patient workspace.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedService = useMemo(() => services.find(service => service.id === serviceId) ?? null, [services, serviceId]);
  const matchingServices = services;

  function chooseService(value: string) {
    setServiceId(value);
    const item = services.find(service => service.id === value);
    if (item && !subject) setSubject(item.name);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError(""); setNotice("");
    if (!selectedService?.hospital?.id) {
      setError("Choose an available service from a participating hospital.");
      setSubmitting(false);
      return;
    }
    if (requestType === "appointment" && (!preferredStartAt || !preferredEndAt)) {
      setError("Enter a preferred start and end time for the appointment request.");
      setSubmitting(false);
      return;
    }
    const startAt = requestType === "appointment" ? localIso(preferredStartAt) : null;
    const endAt = requestType === "appointment" ? localIso(preferredEndAt) : null;
    if (requestType === "appointment" && (!startAt || !endAt || endAt <= startAt)) {
      setError("The preferred end time must be later than the start time.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/patient/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalId: selectedService.hospital.id,
          serviceId: selectedService.id,
          requestType,
          subject: subject.trim(),
          displayName: displayName.trim(),
          phoneNumber: phoneNumber.trim(),
          message: patientMessage.trim(),
          preferredStartAt: startAt,
          preferredEndAt: endAt,
        }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/patient-login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to submit the request.");
      setNotice(`Request ${payload.request?.request_code ?? ""} has been submitted to ${selectedService.hospital.name}.`);
      setSubject(""); setPatientMessage(""); setPreferredStartAt(""); setPreferredEndAt("");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function respond(requestId: string, action: "accept_appointment" | "send_message" | "cancel_request", message = "") {
    setWorkingId(requestId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/patient/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, message }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/patient-login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to update this request.");
      setReplyById(current => ({ ...current, [requestId]: "" }));
      setNotice(action === "cancel_request" ? "Your cancellation request has been sent." : action === "accept_appointment" ? "Your acceptance has been sent to the hospital." : "Your message has been sent.");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the request.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <main className="care-page">
      <header className="care-topbar">
        <Link href="/care" className="care-brand"><span className="care-brand-mark"><Activity size={20} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <nav className="care-header-actions"><Link href="/care" className="care-nav-link">Service directory</Link><span className="care-account">{email || "Patient workspace"}</span><Link href="/patient-login" className="care-nav-primary">Account <ArrowRight size={15} /></Link></nav>
      </header>

      <section className="care-workspace-heading">
        <Link href="/care" className="care-back-link"><ArrowLeft size={14} /> Service directory</Link>
        <span className="care-eyebrow">PATIENT WORKSPACE</span>
        <h1>Your requests and next steps</h1>
        <p>Submit a request to a participating hospital and follow its response. Appointment times are only confirmed by the hospital.</p>
      </section>

      {error && <div className="care-alert error" role="alert">{error}</div>}
      {notice && <div className="care-alert success" role="status"><CheckCircle2 size={16} />{notice}</div>}

      {needsLogin ? (
        <section className="care-login-prompt"><div className="care-empty-mark"><ShieldCheck size={23} /></div><h2>Sign in to see your requests</h2><p>Your requests are private to your account. Sign in or create a patient account to continue.</p><Link className="care-button-primary" href="/patient-login">Patient sign in <ArrowRight size={16} /></Link></section>
      ) : (
        <div className="care-workspace-grid">
          <section className="care-request-form-panel">
            <div className="care-panel-heading"><div><span className="care-eyebrow">NEW REQUEST</span><h2>What do you need help with?</h2></div><span className="care-panel-index">01</span></div>
            <p className="care-panel-intro">Share the minimum details needed to route your request. Avoid including urgent or highly sensitive clinical information.</p>
            {loading ? <div className="care-loading"><span className="care-spinner" /> Loading your workspace…</div> : (
              <form className="care-request-form" onSubmit={submitRequest}>
                <label>Hospital service
                  <select value={serviceId} onChange={event => chooseService(event.target.value)} required>
                    <option value="">Choose a published service</option>
                    {matchingServices.map(service => <option key={service.id} value={service.id}>{service.name} — {service.hospital?.name ?? "Hospital"}</option>)}
                  </select>
                </label>
                {selectedService?.hospital && <div className="care-selected-hospital"><span className="care-selected-hospital-icon"><ShieldCheck size={16} /></span><span><strong>{selectedService.hospital.name}</strong><small>{[selectedService.hospital.city, selectedService.hospital.country].filter(Boolean).join(", ")}</small></span></div>}
                <label>Request type
                  <select value={requestType} onChange={event => setRequestType(event.target.value)}>
                    <option value="appointment">Appointment request</option>
                    <option value="service_request">Service enquiry</option>
                    <option value="follow_up">Follow-up request</option>
                  </select>
                </label>
                <label>Request subject<input required minLength={3} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="e.g. Request an outpatient consultation" /></label>
                {requestType === "appointment" && <div className="care-form-grid"><label>Preferred start<input type="datetime-local" required value={preferredStartAt} onChange={event => setPreferredStartAt(event.target.value)} /></label><label>Preferred end<input type="datetime-local" required value={preferredEndAt} onChange={event => setPreferredEndAt(event.target.value)} /></label></div>}
                <label>Your name<input autoComplete="name" required minLength={2} maxLength={160} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Full name" /></label>
                <label>Contact phone <span className="care-optional">Optional</span><input autoComplete="tel" value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} maxLength={32} placeholder="Phone number for hospital contact" /></label>
                <label>Message to the hospital <span className="care-optional">Optional</span><textarea value={patientMessage} onChange={event => setPatientMessage(event.target.value)} maxLength={3000} rows={4} placeholder="Add information the hospital needs to review your request." /></label>
                <p className="care-privacy-note"><ShieldCheck size={14} /> Your message is shared with the selected hospital's authorised team. This portal is not for emergencies.</p>
                <button className="care-button-primary wide" type="submit" disabled={submitting || !selectedService}>{submitting ? "Submitting request…" : "Submit request"} {!submitting && <ArrowRight size={16} />}</button>
              </form>
            )}
            {!loading && services.length === 0 && <div className="care-form-empty">No services have been published yet. Check the directory again later.</div>}
          </section>

          <section className="care-my-requests">
            <div className="care-panel-heading"><div><span className="care-eyebrow">YOUR ACTIVITY</span><h2>Request history</h2></div><button className="care-icon-button" onClick={() => void load()} disabled={loading} aria-label="Refresh requests"><RefreshCw size={16} /></button></div>
            <div className="care-request-summary"><span><strong>{requests.length}</strong> requests</span><span><strong>{requests.filter(item => !terminal.has(item.status)).length}</strong> still active</span></div>
            {loading && <div className="care-loading"><span className="care-spinner" /> Loading requests…</div>}
            {!loading && requests.length === 0 && <div className="care-empty compact-empty"><div className="care-empty-mark"><CalendarClock size={20} /></div><h3>No requests yet</h3><p>Once you submit a request, its status and hospital updates will appear here.</p></div>}
            <div className="care-request-list">
              {requests.map(item => (
                <article className="care-request-card" key={item.id}>
                  <div className="care-request-card-top"><span className="care-request-code">{item.request_code}</span><span className={`care-status care-status-${item.status}`}>{statusLabel[item.status] ?? item.status.replaceAll("_", " ")}</span></div>
                  <h3>{item.subject}</h3>
                  <div className="care-request-meta"><span>{item.hospital?.name ?? "Participating hospital"}</span><span>·</span><span>{item.service?.name ?? "Service"}</span></div>
                  <div className="care-request-date">Submitted {formatDate(item.submitted_at || item.created_at, false)}</div>

                  {item.appointment && <div className="care-appointment-box"><div className="care-appointment-title"><CalendarClock size={16} /><strong>{item.appointment.status === "confirmed" ? "Confirmed appointment" : "Appointment details"}</strong></div><p>{formatDate(item.appointment.start_at)} — {formatDate(item.appointment.end_at)}</p>{item.appointment.location && <span>{item.appointment.location}</span>}{item.appointment.patient_instructions && <p className="care-appointment-instructions">{item.appointment.patient_instructions}</p>}{item.appointment.status === "proposed" && <button className="care-button-primary small" onClick={() => void respond(item.id, "accept_appointment")} disabled={workingId === item.id}>{workingId === item.id ? "Sending…" : "Accept proposed time"} <CheckCircle2 size={14} /></button>}{item.appointment.status === "patient_accepted" && <p className="care-awaiting-note">You accepted this time. The hospital must confirm it before it is booked.</p>}</div>}

                  {item.messages.length > 0 && <div className="care-message-thread"><div className="care-thread-heading"><MessageCircle size={14} /> Updates</div>{item.messages.slice(-3).map(message => <div className={`care-message care-message-${message.author_type}`} key={message.id}><div><strong>{message.author_type === "patient" ? "You" : message.author_type === "staff" ? "Hospital team" : "Converge"}</strong><time>{formatDate(message.created_at)}</time></div><p>{message.body}</p></div>)}</div>}

                  {!terminal.has(item.status) && <div className="care-request-actions">
                    <form className="care-inline-reply" onSubmit={event => { event.preventDefault(); const value = replyById[item.id]?.trim(); if (value) void respond(item.id, "send_message", value); }}>
                      <input aria-label="Message to hospital" value={replyById[item.id] ?? ""} onChange={event => setReplyById(current => ({ ...current, [item.id]: event.target.value }))} maxLength={3000} placeholder="Send a message to the hospital" />
                      <button type="submit" disabled={workingId === item.id || !(replyById[item.id] ?? "").trim()} aria-label="Send message"><Send size={15} /></button>
                    </form>
                    {item.status !== "cancellation_requested" && <button className="care-cancel-link" onClick={() => void respond(item.id, "cancel_request")} disabled={workingId === item.id}><XCircle size={14} /> {item.status === "confirmed" || item.status === "in_progress" ? "Request cancellation" : "Cancel request"}</button>}
                  </div>}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      <footer className="care-footer"><Link href="/care" className="care-brand compact"><span className="care-brand-mark"><Activity size={17} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link><span>Only participating hospitals can respond to requests submitted here.</span><Link href="/login">Hospital team sign in</Link></footer>
    </main>
  );
}
