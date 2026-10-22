"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowLeft, ArrowRight, Bell, Check, CheckCheck, Clock3,
  RefreshCw, ShieldCheck, Workflow,
} from "lucide-react";
import styles from "./notifications.module.css";

type Notification = {
  id: string;
  hospital_id: string;
  notification_type: string;
  title: string;
  body: string;
  action_url: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  read_at: string | null;
};
type NotificationData = {
  hospital: { id: string; name: string; city: string | null; country: string };
  unreadCount: number;
  notifications: Notification[];
};
type ViewFilter = "all" | "unread";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function relativeAge(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  return days + (days === 1 ? " day ago" : " days ago");
}

function safeActionUrl(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\\\")) return "/my-work";
  return value;
}

function typeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("all");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/notifications", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load notifications.");
      setData(payload as NotificationData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load notifications.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const notifications = data?.notifications ?? [];
  const visible = useMemo(
    () => notifications.filter(item => filter === "all" || !item.read_at),
    [notifications, filter],
  );

  async function markRead(item: Notification) {
    if (!data || item.read_at) return;
    setSavingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/operations/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: data.hospital.id, notificationId: item.id }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to mark this notification as read.");
      const readAt = payload.notification?.read_at ?? new Date().toISOString();
      setData(current => current ? {
        ...current,
        unreadCount: Math.max(0, current.unreadCount - 1),
        notifications: current.notifications.map(row => row.id === item.id ? { ...row, read_at: readAt } : row),
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update this notification.");
    } finally {
      setSavingId("");
    }
  }

  async function markAllRead() {
    if (!data || !data.unreadCount) return;
    setMarkingAll(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/operations/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: data.hospital.id, markAllRead: true }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to mark notifications as read.");
      const readAt = new Date().toISOString();
      setData(current => current ? {
        ...current,
        unreadCount: 0,
        notifications: current.notifications.map(row => row.read_at ? row : { ...row, read_at: readAt }),
      } : current);
      setNotice((payload.markedRead ?? 0) + " notification(s) marked as read.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update notifications.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo app-section-logo" /></Link>
        <nav className={styles.headerActions}>
          <Link href="/my-work" className={styles.headerLink}><Workflow size={14} /> My work</Link>
          <Link href="/ai-agents" className={styles.headerLink}>Operations analyst</Link>
          <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Workspace</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>WORKSPACE / IN-APP UPDATES</span>
          <h1>Notifications</h1>
          <p>Task assignments and operational updates for your active hospital workspace.</p>
          {data?.hospital && <div className={styles.hospitalLine}><span /> <strong>{data.hospital.name}</strong>{data.hospital.city ? " · " + data.hospital.city : ""}</div>}
        </div>
        <div className={styles.heroActions}>
          <span className={styles.unreadBadge}><Bell size={14} /> {data?.unreadCount ?? 0} unread</span>
          <button className={styles.refreshButton} onClick={() => void load(true)} disabled={loading || refreshing}><RefreshCw size={14} className={refreshing ? styles.spinning : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
      </section>

      {error && <section role="alert" className={styles.error}><span>{error}</span><button onClick={() => void load(true)}>Retry</button></section>}
      {notice && <section role="status" className={styles.notice}><Check size={15} /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></section>}

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><span className={styles.eyebrow}>RECENT ACTIVITY</span><h2>Your updates</h2><p>Notifications are private to your account and hospital membership.</p></div>
          <button className={styles.markAllButton} onClick={() => void markAllRead()} disabled={!data?.unreadCount || markingAll || loading}><CheckCheck size={14} />{markingAll ? "Marking…" : "Mark all read"}</button>
        </div>
        <div className={styles.filters}>
          <button className={filter === "all" ? styles.activeFilter : ""} onClick={() => setFilter("all")}>All updates <span>{notifications.length}</span></button>
          <button className={filter === "unread" ? styles.activeFilter : ""} onClick={() => setFilter("unread")}>Unread <span>{data?.unreadCount ?? 0}</span></button>
        </div>

        {loading && !data ? <div className={styles.empty}><span className={styles.spinner} /><p>Loading notifications…</p></div> :
          visible.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><Bell size={22} /></span><h3>{filter === "unread" ? "You are all caught up" : "No notifications yet"}</h3><p>{filter === "unread" ? "New task assignments and updates will appear here." : "When an operational task is assigned to you, an update will appear here."}</p><Link href="/my-work">Open my work <ArrowRight size={14} /></Link></div> :
          <div className={styles.list}>
            {visible.map(item => <article key={item.id} className={styles.notification + " " + (!item.read_at ? styles.unread : "")}>
              <span className={styles.notificationIcon}>{item.notification_type === "work_item_status_changed" ? <CheckCheck size={17} /> : <Bell size={17} />}</span>
              <div className={styles.notificationBody}>
                <div className={styles.notificationTop}><strong>{item.title}</strong>{!item.read_at && <span className={styles.unreadDot} />}</div>
                <p>{item.body}</p>
                <div className={styles.meta}><span>{typeLabel(item.notification_type)}</span><span title={formatDate(item.created_at)}><Clock3 size={12} />{relativeAge(item.created_at)}</span></div>
                <div className={styles.actions}>
                  <Link href={safeActionUrl(item.action_url)}>{item.read_at ? "Open My Work" : "View related work"} <ArrowRight size={13} /></Link>
                  {!item.read_at && <button onClick={() => void markRead(item)} disabled={savingId === item.id}><Check size={13} />{savingId === item.id ? "Saving…" : "Mark read"}</button>}
                </div>
              </div>
            </article>)}
          </div>
        }
        <footer className={styles.panelFooter}><span>{visible.length} notification(s) shown</span><Link href="/my-work">View assigned work <ArrowRight size={14} /></Link></footer>
      </section>
      <footer className={styles.pageFooter}><span><ShieldCheck size={14} /> Notifications are scoped to your active hospital.</span><span>Assignment and status updates are logged.</span></footer>
    </main>
  );
}
