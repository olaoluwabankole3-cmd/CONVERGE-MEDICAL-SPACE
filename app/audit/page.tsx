"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, CheckCircle2, Clock3, Download, FileClock, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type EventRow = { id: number; entity_type: string; entity_id: string; action: string; details: Record<string, unknown> | null; created_at: string };
type EventCategory = "all" | "work" | "requests" | "appointments" | "governance";

const CATEGORY_FILTERS: { value: EventCategory; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "work", label: "Work items" },
  { value: "requests", label: "Patient requests" },
  { value: "appointments", label: "Appointments" },
  { value: "governance", label: "Governance" },
];
const SAFE_DETAIL_KEYS = ["reference_code", "request_code", "item_type", "priority", "status", "previous_status", "new_status", "role", "appointment_status", "due_at"];

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function categoryFor(event: EventRow): Exclude<EventCategory, "all"> {
  const entity = event.entity_type.toLowerCase();
  if (entity.includes("work") || entity.includes("follow_up") || entity.includes("task")) return "work";
  if (entity.includes("request")) return "requests";
  if (entity.includes("appointment")) return "appointments";
  return "governance";
}
function safeDetails(details: EventRow["details"]) {
  if (!details) return [];
  return SAFE_DETAIL_KEYS.flatMap(key => {
    const value = details[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
    const display = String(value).slice(0, 140);
    return [{ key: titleCase(key), value: display }];
  });
}

export default function AuditHistoryPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [hospitalName, setHospitalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<EventCategory>("all");

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this deployment."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { router.replace("/login"); return; }
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
        setEvents([]);
        throw new Error("Audit history is available only to members of an active hospital workspace.");
      }
      const { data, error: eventError } = await supabase
        .from("audit_events")
        .select("id,entity_type,entity_id,action,details,created_at")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (eventError) throw eventError;
      setEvents((data ?? []) as EventRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load audit history.");
    } finally {
      setLoading(false);
    }
  }, [router, supabase]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter(event => {
      const matchesCategory = category === "all" || categoryFor(event) === category;
      const matchesSearch = !query || [
        event.action, event.entity_type, event.entity_id,
        typeof event.details?.reference_code === "string" ? event.details.reference_code : "",
        typeof event.details?.request_code === "string" ? event.details.request_code : "",
        typeof event.details?.item_type === "string" ? event.details.item_type : "",
        typeof event.details?.status === "string" ? event.details.status : "",
      ].some(value => value.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [events, category, search]);

  const last24Hours = events.filter(event => Date.now() - new Date(event.created_at).getTime() <= 24 * 60 * 60 * 1000).length;
  const workEvents = events.filter(event => categoryFor(event) === "work").length;
  const requestEvents = events.filter(event => categoryFor(event) === "requests").length;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());

  function exportCsv() {
    const rows = [
      ["Timestamp", "Entity", "Action", "Reference", "Entity ID"],
      ...visible.map(event => [
        formatTimestamp(event.created_at),
        event.entity_type,
        event.action,
        typeof event.details?.reference_code === "string" ? event.details.reference_code : typeof event.details?.request_code === "string" ? event.details.request_code : "",
        event.entity_id,
      ]),
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "converge-audit-history.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="audit-page">
      <header className="audit-topbar">
        <Link href="/" className="audit-brand"><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo app-section-logo" /></Link>
        <div className="ops-queue-topbar-right">
          <span className="ops-queue-hospital"><span className="ops-live-dot"/>{hospitalName || "Hospital workspace"}</span>
          <Link href="/team" className="ops-queue-utility"><ShieldCheck size={15}/> Team & access</Link>
          <Link href="/reports" className="ops-queue-utility"><ArrowRight size={15}/> Reports</Link>
        </div>
      </header>

      <div className="audit-content">
        <div className="ops-queue-breadcrumb"><Link href="/">Workspace</Link><span>/</span><span>Governance</span><span>/</span><strong>Audit history</strong></div>
        <div className="audit-heading">
          <div>
            <div className="audit-kicker"><FileClock size={17}/> GOVERNANCE / RECORD OF CHANGE</div>
            <h1>Audit history</h1>
            <p>A time-ordered record of operational changes in your authorised hospital workspace. Search changes, narrow the event category, and export the currently filtered view.</p>
          </div>
          <div className="audit-actions">
            <button className="ops-queue-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "ops-spin" : ""}/> Refresh</button>
            <button className="ops-queue-primary-button" onClick={exportCsv} disabled={loading || visible.length === 0}><Download size={15}/> Export CSV</button>
          </div>
        </div>
        <div className="audit-date-line"><Clock3 size={14}/>{todayLabel}<span>·</span>Latest {events.length} recorded events</div>

        {error && <div className="ops-queue-alert error" role="alert"><ShieldCheck size={17}/><span>{error}</span></div>}

        <section className="audit-metrics" aria-label="Audit summary">
          <article><span>Recorded events</span><strong>{loading ? "—" : events.length}</strong><small>Most recent 500 events available</small></article>
          <article><span>Last 24 hours</span><strong>{loading ? "—" : last24Hours}</strong><small>Recent activity in this workspace</small></article>
          <article><span>Work item events</span><strong>{loading ? "—" : workEvents}</strong><small>Tasks, cases and operational changes</small></article>
          <article><span>Request events</span><strong>{loading ? "—" : requestEvents}</strong><small>Patient-request lifecycle changes</small></article>
        </section>

        <section className="audit-panel">
          <div className="audit-panel-top">
            <div><span className="ops-queue-overline">ACTIVITY REGISTER</span><h2>Recorded events</h2><p>Event details are limited to operational metadata safe for this summary view.</p></div>
            <span className="audit-event-count">{loading ? "Loading…" : `${visible.length} matching`}</span>
          </div>
          <div className="audit-toolbar">
            <label className="audit-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search action, entity or reference" aria-label="Search audit events"/></label>
            <div className="audit-filters" aria-label="Filter audit events">
              {CATEGORY_FILTERS.map(item => <button key={item.value} className={category === item.value ? "active" : ""} onClick={() => setCategory(item.value)}>{item.label}</button>)}
            </div>
          </div>

          {loading ? (
            <div className="audit-empty"><span className="audit-empty-icon"><RefreshCw size={20} className="ops-spin"/></span><strong>Loading audit history</strong><p>Retrieving events permitted for your active hospital workspace.</p></div>
          ) : visible.length === 0 ? (
            <div className="audit-empty"><span className="audit-empty-icon"><CheckCircle2 size={22}/></span><strong>{events.length === 0 ? "No events recorded yet" : "No matching events"}</strong><p>{events.length === 0 ? "When a governed workflow records a change, it will appear here." : "Try a different category or search term."}</p></div>
          ) : (
            <div className="audit-event-list">
              {visible.map(event => {
                const detailItems = safeDetails(event.details);
                const reference = typeof event.details?.reference_code === "string" ? event.details.reference_code : typeof event.details?.request_code === "string" ? event.details.request_code : event.entity_id.slice(0, 8).toUpperCase();
                return <article className="audit-event" key={event.id}>
                  <span className="audit-event-mark"><FileClock size={16}/></span>
                  <div className="audit-event-main">
                    <h3>{titleCase(event.action)}</h3>
                    <p>{titleCase(event.entity_type)} <span>·</span> <span className="audit-event-ref">{reference}</span></p>
                    {detailItems.length > 0 && <div className="audit-detail-grid">{detailItems.map(item => <span key={item.key}><small>{item.key}</small><strong>{item.value}</strong></span>)}</div>}
                  </div>
                  <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
                </article>;
              })}
            </div>
          )}
          <div className="ops-queue-panel-footer"><span>Event visibility is scoped by hospital membership and database policies.</span><Link href="/team">Review access permissions <ArrowRight size={14}/></Link></div>
        </section>
        <p className="audit-footer"><ShieldCheck size={15}/> Audit history is a read-only record. Do not treat it as a replacement for formal records-retention, incident-response or compliance systems.</p>
      </div>
    </main>
  );
}
