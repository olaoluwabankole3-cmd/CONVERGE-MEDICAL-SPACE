"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AppointmentRow = {
  id: string; hospital_id: string; patient_request_id: string; status: string;
  start_at: string; end_at: string; location: string | null; patient_instructions: string | null;
  proposed_by: string; confirmed_by: string | null; confirmed_at: string | null;
  created_at: string; updated_at: string;
};
type RequestRow = {
  id: string; request_code: string; subject: string; request_type: string; status: string;
  patient_record_id: string | null; service_id: string | null;
};
type ReferenceRow = { id: string; reference_code: string; care_area: string | null };
type ServiceRow = { id: string; name: string; department: string | null };
type AppointmentView = AppointmentRow & { request: RequestRow | null; reference: ReferenceRow | null; service: ServiceRow | null };

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  patient_accepted: "Patient accepted",
  reschedule_requested: "Reschedule requested",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};
const FILTERS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "proposed", label: "Needs review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All appointments" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function statusClass(status: string) {
  return STATUS_LABELS[status] ? status : "proposed";
}

export default function AppointmentsPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [hospitalName, setHospitalName] = useState("");
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("upcoming");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        router.replace("/login");
        return;
      }
      const { data: memberships, error: memberError } = await supabase
        .from("hospital_memberships").select("hospital_id,created_at")
        .order("created_at", { ascending: false }).limit(10);
      if (memberError) throw memberError;

      let hospitalId = "";
      for (const membership of memberships ?? []) {
        const { data: hospital, error: hospitalError } = await supabase
          .from("hospitals").select("id,name,status").eq("id", membership.hospital_id).maybeSingle();
        if (hospitalError) throw hospitalError;
        if (hospital?.status === "active") {
          hospitalId = hospital.id;
          setHospitalName(hospital.name);
          break;
        }
      }
      if (!hospitalId) {
        setAppointments([]);
        throw new Error("An active hospital membership is required to view appointments.");
      }

      const { data: appointmentRows, error: appointmentsError } = await supabase
        .from("appointments")
        .select("id,hospital_id,patient_request_id,status,start_at,end_at,location,patient_instructions,proposed_by,confirmed_by,confirmed_at,created_at,updated_at")
        .eq("hospital_id", hospitalId)
        .order("start_at", { ascending: true })
        .limit(500);
      if (appointmentsError) throw appointmentsError;

      const rows = (appointmentRows ?? []) as AppointmentRow[];
      const requestIds = [...new Set(rows.map(row => row.patient_request_id))];
      const requestQuery = requestIds.length
        ? await supabase.from("patient_requests")
            .select("id,request_code,subject,request_type,status,patient_record_id,service_id")
            .eq("hospital_id", hospitalId).in("id", requestIds)
        : { data: [], error: null };
      if (requestQuery.error) throw requestQuery.error;
      const requests = (requestQuery.data ?? []) as RequestRow[];
      const requestById = new Map(requests.map(request => [request.id, request]));

      const referenceIds = [...new Set(requests.map(request => request.patient_record_id).filter((id): id is string => !!id))];
      const serviceIds = [...new Set(requests.map(request => request.service_id).filter((id): id is string => !!id))];
      const [referenceQuery, serviceQuery] = await Promise.all([
        referenceIds.length
          ? supabase.from("patient_records").select("id,reference_code,care_area").eq("hospital_id", hospitalId).in("id", referenceIds)
          : Promise.resolve({ data: [], error: null }),
        serviceIds.length
          ? supabase.from("hospital_services").select("id,name,department").eq("hospital_id", hospitalId).in("id", serviceIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (referenceQuery.error) throw referenceQuery.error;
      if (serviceQuery.error) throw serviceQuery.error;

      const referenceById = new Map(((referenceQuery.data ?? []) as ReferenceRow[]).map(reference => [reference.id, reference]));
      const serviceById = new Map(((serviceQuery.data ?? []) as ServiceRow[]).map(service => [service.id, service]));
      setAppointments(rows.map(row => {
        const request = requestById.get(row.patient_request_id) ?? null;
        return {
          ...row,
          request,
          reference: request?.patient_record_id ? referenceById.get(request.patient_record_id) ?? null : null,
          service: request?.service_id ? serviceById.get(request.service_id) ?? null : null,
        };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load appointments for this hospital.");
    } finally {
      setLoading(false);
    }
  }, [router, supabase]);

  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const upcomingCount = appointments.filter(item => new Date(item.start_at).getTime() >= now && !["completed", "cancelled", "no_show"].includes(item.status)).length;
  const needsReviewCount = appointments.filter(item => ["proposed", "patient_accepted", "reschedule_requested"].includes(item.status)).length;
  const confirmedCount = appointments.filter(item => item.status === "confirmed").length;
  const completedCount = appointments.filter(item => item.status === "completed").length;

  const visible = useMemo(() => appointments.filter(item => {
    const isUpcoming = new Date(item.start_at).getTime() >= Date.now() && !["completed", "cancelled", "no_show"].includes(item.status);
    const matchesFilter = filter === "all" ||
      (filter === "upcoming" && isUpcoming) ||
      (filter === "proposed" && ["proposed", "patient_accepted", "reschedule_requested"].includes(item.status)) ||
      item.status === filter;
    const q = search.trim().toLowerCase();
    const haystack = [
      item.request?.request_code ?? "", item.request?.subject ?? "", item.status,
      item.location ?? "", item.reference?.reference_code ?? "", item.reference?.care_area ?? "",
      item.service?.name ?? "", item.service?.department ?? "",
    ].join(" ").toLowerCase();
    return matchesFilter && (!q || haystack.includes(q));
  }), [appointments, filter, search]);

  return (
    <main className="appointments-page">
      <header className="appointments-topbar">
        <Link href="/" className="appointments-brand">
          <span className="appointments-brand-mark"><Activity size={20}/></span>
          <span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span>
        </Link>
        <div className="ops-queue-topbar-right">
          <span className="ops-queue-hospital"><span className="ops-live-dot"/>{hospitalName || "Hospital workspace"}</span>
          <Link href="/requests" className="ops-queue-utility"><ArrowRight size={15}/> Request workflow</Link>
          <Link href="/audit" className="ops-queue-utility"><ShieldCheck size={15}/> Audit history</Link>
        </div>
      </header>

      <div className="appointments-content">
        <div className="ops-queue-breadcrumb"><Link href="/">Workspace</Link><span>/</span><span>Operations</span><span>/</span><strong>Appointments</strong></div>
        <div className="appointments-heading">
          <div>
            <div className="appointments-kicker"><CalendarDays size={17}/> APPOINTMENT COORDINATION</div>
            <h1>Appointments</h1>
            <p>Keep proposed times, confirmed visits and appointment outcomes together. Use the request workflow to review proposals and confirm scheduling decisions.</p>
          </div>
          <div className="appointments-actions">
            <button className="ops-queue-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "ops-spin" : ""}/> Refresh</button>
            <Link className="ops-queue-primary-button" href="/requests">Open request workflow <ArrowRight size={15}/></Link>
          </div>
        </div>

        {error && <div className="ops-queue-alert error" role="alert"><AlertCircle size={17}/><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

        <section className="appointment-metrics" aria-label="Appointment summary">
          <article><span>Upcoming appointments</span><strong>{loading ? "—" : upcomingCount}</strong><small>Scheduled for now or later</small></article>
          <article><span>Needs review</span><strong>{loading ? "—" : needsReviewCount}</strong><small>Proposals or patient responses</small></article>
          <article><span>Confirmed</span><strong>{loading ? "—" : confirmedCount}</strong><small>Ready for the planned visit</small></article>
          <article><span>Completed</span><strong>{loading ? "—" : completedCount}</strong><small>Visit marked as completed</small></article>
        </section>

        <section className="appointments-panel">
          <div className="appointments-panel-top">
            <div><span className="ops-queue-overline">SCHEDULE REGISTER</span><h2>Appointment list</h2><p>Appointment records are read from the hospital-scoped appointment register.</p></div>
            <span className="ops-queue-result-count">{loading ? "Loading…" : `${visible.length} shown`}</span>
          </div>
          <div className="appointments-toolbar">
            <label className="appointments-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search request, service, reference or location" aria-label="Search appointments"/></label>
            <div className="appointments-filters" aria-label="Appointment filters">
              {FILTERS.map(item => <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
            </div>
          </div>

          {loading ? (
            <div className="ops-queue-state"><span className="ops-queue-state-mark"><RefreshCw size={19} className="ops-spin"/></span><strong>Loading appointment register</strong><p>Retrieving the latest appointment records for this hospital.</p></div>
          ) : visible.length === 0 ? (
            <div className="ops-queue-state"><span className="ops-queue-state-mark"><CalendarDays size={21}/></span><strong>{appointments.length === 0 ? "No appointments recorded yet" : "No appointments match this view"}</strong><p>{appointments.length === 0 ? "When a staff member proposes an appointment through a patient request, it will appear here. Appointment creation and confirmation remain governed by the request workflow." : "Try another filter or search term to find the appointment you are looking for."}</p><Link href="/requests" className="ops-queue-primary-button">Go to patient requests <ArrowRight size={15}/></Link></div>
          ) : (
            <div className="appointments-list">
              {visible.map(item => {
                const start = new Date(item.start_at);
                const end = new Date(item.end_at);
                return <article key={item.id} className="appointment-card">
                  <div className="appointment-date-box"><strong>{new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(start)}</strong><span>{new Intl.DateTimeFormat("en-GB", { month: "short" }).format(start)}</span><small>{new Intl.DateTimeFormat("en-GB", { year: "numeric" }).format(start)}</small></div>
                  <div className="appointment-main">
                    <span className="appointment-code">{item.request?.request_code ?? `APT-${item.id.slice(0, 8).toUpperCase()}`}</span>
                    <h3>{item.request?.subject ?? "Appointment request"}</h3>
                    <div className="appointment-meta">
                      <span><Clock3 size={13}/>{formatTime(item.start_at)}–{formatTime(item.end_at)}</span>
                      {item.service && <span><CheckCircle2 size={13}/>{item.service.name}{item.service.department ? ` · ${item.service.department}` : ""}</span>}
                      {item.location && <span><MapPin size={13}/>{item.location}</span>}
                    </div>
                    {item.reference && <span className="appointment-reference">Patient reference · {item.reference.reference_code}{item.reference.care_area ? ` · ${item.reference.care_area}` : ""}</span>}
                    {!item.reference && item.request?.request_type && <span className="appointment-reference">{item.request.request_type.replaceAll("_", " ")}</span>}
                    {item.patient_instructions && <p className="appointment-description">{item.patient_instructions}</p>}
                  </div>
                  <div className="appointment-card-side">
                    <span className={`appointment-status ${statusClass(item.status)}`}>{STATUS_LABELS[item.status] ?? item.status.replaceAll("_", " ")}</span>
                    <time>{formatDate(item.start_at)}</time>
                    <Link href="/requests" className="appointment-request-link">Review request <ArrowRight size={13}/></Link>
                  </div>
                </article>;
              })}
            </div>
          )}
          <div className="ops-queue-panel-footer"><span>Hospital-scoped appointment records · Scheduling decisions stay in the request workflow.</span><Link href="/work?type=appointment">View appointment work <ArrowRight size={14}/></Link></div>
        </section>
        <p className="ops-queue-privacy"><ShieldCheck size={15}/> This page presents minimal scheduling context. Patient request details and messages remain in the authorised request workflow.</p>
      </div>
    </main>
  );
}
