"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2,
  Clock3, ListChecks, RefreshCw, ShieldCheck, UserRound, Bell,
} from "lucide-react";
import styles from "./my-work.module.css";

type WorkStatus = "open" | "needs_review" | "in_progress" | "awaiting_response" | "resolved" | "closed";
type WorkItem = {
  id: string;
  hospital_id: string;
  reference_code: string;
  title: string;
  summary: string | null;
  item_type: string;
  priority: string;
  status: WorkStatus;
  owner_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};
type WorkData = {
  hospital: { id: string; name: string; city: string | null; country: string };
  role: string;
  generatedAt: string;
  metrics: { assignedOpen: number; dueSoon: number; overdue: number; highPriority: number };
  items: WorkItem[];
};
type FilterKey = "active" | "due_soon" | "overdue" | "all" | "completed";

const STATUS_LABELS: Record<WorkStatus, string> = {
  open: "Open",
  needs_review: "Needs review",
  in_progress: "In progress",
  awaiting_response: "Awaiting response",
  resolved: "Resolved",
  closed: "Closed",
};
const TERMINAL = new Set(["resolved", "closed"]);
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "active", label: "Active" },
  { key: "due_soon", label: "Due soon" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All assigned" },
];

function formatDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function dueKind(item: WorkItem, now: number): "overdue" | "due_soon" | "scheduled" | "none" | "complete" {
  if (TERMINAL.has(item.status)) return "complete";
  if (!item.due_at) return "none";
  const due = Date.parse(item.due_at);
  if (!Number.isFinite(due)) return "none";
  if (due < now) return "overdue";
  if (due <= now + 48 * 60 * 60 * 1000) return "due_soon";
  return "scheduled";
}

function itemLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, value => value.toUpperCase());
}

export default function MyWorkPage() {
  const [data, setData] = useState<WorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<FilterKey>("active");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/my-work", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load your assigned work.");
      setData(payload as WorkData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load assigned work.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = data?.items ?? [];
  const now = Date.now();
  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(item => {
      const kind = dueKind(item, now);
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && !TERMINAL.has(item.status)) ||
        (filter === "due_soon" && kind === "due_soon") ||
        (filter === "overdue" && kind === "overdue") ||
        (filter === "completed" && TERMINAL.has(item.status));
      const matchesSearch = !term || [item.reference_code, item.title, item.summary ?? "", item.status, item.item_type].some(value => value.toLowerCase().includes(term));
      return matchesFilter && matchesSearch;
    }).sort((a, b) => {
      const rank = (item: WorkItem) => {
        const kind = dueKind(item, now);
        if (kind === "overdue") return 0;
        if (kind === "due_soon") return 1;
        if (["high", "urgent"].includes(item.priority)) return 2;
        if (TERMINAL.has(item.status)) return 4;
        return 3;
      };
      return rank(a) - rank(b) || (a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER) - (b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER);
    });
  }, [items, filter, search, now]);

  async function updateStatus(item: WorkItem, status: WorkStatus) {
    if (!data || status === item.status) return;
    setSavingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/operations/my-work", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: data.hospital.id, workItemId: item.id, status }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to update this work item.");
      const updated = payload.workItem as WorkItem;
      setData(current => current ? {
        ...current,
        items: current.items.map(row => row.id === updated.id ? { ...row, ...updated } : row),
      } : current);
      setNotice(item.reference_code + " updated to " + STATUS_LABELS[status] + ". The change was audited.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the work item.");
    } finally {
      setSavingId("");
    }
  }

  const metrics = data?.metrics ?? { assignedOpen: 0, dueSoon: 0, overdue: 0, highPriority: 0 };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span className={styles.brandMark}><Activity size={19} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <nav className={styles.headerActions}>
          <Link href="/notifications" className={styles.headerLink}><Bell size={14} /> Notifications</Link>
          <Link href="/ai-agents" className={styles.headerLink}>Operations analyst</Link>
          <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Workspace</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>MY WORK / OPERATIONAL FOLLOW-THROUGH</span>
          <h1>Work assigned to me</h1>
          <p>Track ownership, due dates and progress in your active hospital workspace.</p>
          {data?.hospital && <div className={styles.hospitalLine}><span /> <strong>{data.hospital.name}</strong>{data.hospital.city ? " · " + data.hospital.city : ""}</div>}
        </div>
        <button className={styles.refreshButton} onClick={() => void load(true)} disabled={loading || refreshing}><RefreshCw size={14} className={refreshing ? styles.spinning : ""} />{refreshing ? "Refreshing…" : "Refresh work"}</button>
      </section>

      {error && <section role="alert" className={styles.error}><AlertCircle size={16} /><span>{error}</span><button onClick={() => void load(true)}>Retry</button></section>}
      {notice && <section role="status" className={styles.notice}><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></section>}

      <section className={styles.metrics}>
        <article><span>Active assigned work</span><strong>{metrics.assignedOpen}</strong><small>Not yet resolved or closed</small></article>
        <article><span>Due in 48 hours</span><strong>{metrics.dueSoon}</strong><small>Upcoming deadlines</small></article>
        <article className={styles.alertMetric}><span>Overdue</span><strong>{metrics.overdue}</strong><small>Past due and not complete</small></article>
        <article><span>High priority</span><strong>{metrics.highPriority}</strong><small>High or urgent open items</small></article>
      </section>

      <section className={styles.queue}>
        <div className={styles.queueHeading}>
          <div><span className={styles.eyebrow}>PERSONAL QUEUE</span><h2>Assigned tasks</h2></div>
          <label className={styles.search}><span>Search</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Reference or task title" /></label>
        </div>
        <div className={styles.filters}>{FILTERS.map(item => <button key={item.key} onClick={() => setFilter(item.key)} className={filter === item.key ? styles.activeFilter : ""}>{item.label}{item.key === "overdue" && metrics.overdue > 0 ? <b>{metrics.overdue}</b> : null}</button>)}</div>
        {loading && !data ? <div className={styles.empty}><span className={styles.spinner} /><p>Loading assigned work…</p></div> :
          visibleItems.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><ListChecks size={22} /></span><h3>No work in this view</h3><p>{items.length === 0 ? "When work is assigned to your account, it will appear here." : "Try another filter or clear your search."}</p></div> :
          <div className={styles.items}>
            {visibleItems.map(item => {
              const kind = dueKind(item, now);
              return <article className={styles.workCard} key={item.id}>
                <div className={styles.cardTop}>
                  <div className={styles.refLine}><span>{item.reference_code}</span><span className={styles.type}>{itemLabel(item.item_type)}</span></div>
                  <span className={styles.priority + " " + styles["priority_" + item.priority]}>{itemLabel(item.priority)}</span>
                </div>
                <h3>{item.title}</h3>
                {item.summary && <p className={styles.summary}>{item.summary}</p>}
                <div className={styles.details}>
                  <div className={styles.dueLine + " " + (kind === "overdue" ? styles.dueOverdue : kind === "due_soon" ? styles.dueSoon : "")}>
                    {kind === "overdue" ? <AlertCircle size={14} /> : kind === "due_soon" ? <CalendarClock size={14} /> : <Clock3 size={14} />}
                    <span>{item.due_at ? (kind === "overdue" ? "Overdue · " : kind === "due_soon" ? "Due soon · " : "Due · ") + formatDate(item.due_at) : "No due date"}</span>
                  </div>
                  <span className={styles.status}>{STATUS_LABELS[item.status]}</span>
                </div>
                <div className={styles.cardActions}>
                  <label>Update progress<select value={item.status} disabled={savingId === item.id || TERMINAL.has(item.status)} onChange={event => void updateStatus(item, event.target.value as WorkStatus)}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  {TERMINAL.has(item.status) ? <span className={styles.completed}><CheckCircle2 size={14} /> Completed</span> : <span className={styles.updateHint}>{savingId === item.id ? "Saving…" : "Changes are audited"}</span>}
                </div>
              </article>;
            })}
          </div>
        }
        <footer className={styles.queueFooter}><span>{visibleItems.length} shown · {items.length} assigned item(s)</span><Link href="/requests">Patient request queue <ArrowRight size={14} /></Link></footer>
      </section>

      <footer className={styles.pageFooter}><span><ShieldCheck size={14} /> Hospital-scoped, assigned work only.</span><span>Status changes are recorded in the audit history.</span></footer>
    </main>
  );
}
