"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, Download, FileBarChart2, RefreshCw, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type WorkRow = { id: string; reference_code: string; title: string; item_type: string; priority: string; status: string; due_at: string | null; created_at: string; updated_at: string };
const statuses = ["all", "open", "needs_review", "in_progress", "awaiting_response", "resolved", "closed"];
const statusLabels: Record<string, string> = { all: "All statuses", draft: "Draft", open: "Open", needs_review: "Needs review", in_progress: "In progress", awaiting_response: "Awaiting response", resolved: "Resolved", closed: "Closed" };
const typeLabels: Record<string, string> = { access_case: "Access case", appointment: "Appointment", follow_up: "Follow-up", exception: "Exception", task: "Task" };
const terminal = ["resolved", "closed"];

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      if (!hospital || hospital.status !== "active") throw new Error("Reports are available after hospital activation.");
      const { data, error: itemsError } = await supabase.from("work_items")
        .select("id,reference_code,title,item_type,priority,status,due_at,created_at,updated_at")
        .eq("hospital_id", hospital.id).order("updated_at", { ascending: false }).limit(1000);
      if (itemsError) throw itemsError;
      setHospitalName(hospital.name); setRows((data ?? []) as WorkRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load workspace reports.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter(row =>
    (status === "all" || row.status === status) && (type === "all" || row.item_type === type)
  ), [rows, status, type]);
  const openCount = filtered.filter(row => !terminal.includes(row.status)).length;
  const overdueCount = filtered.filter(row => row.due_at && new Date(row.due_at).getTime() < Date.now() && !terminal.includes(row.status)).length;
  const urgentCount = filtered.filter(row => ["urgent", "high"].includes(row.priority) && !terminal.includes(row.status)).length;

  function exportCsv() {
    const columns = ["reference_code", "title", "item_type", "priority", "status", "due_at", "created_at", "updated_at"];
    const csv = [columns.join(","), ...filtered.map(row => columns.map(column => csvCell(row[column as keyof WorkRow])).join(","))].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `converge-work-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <Link href="/" className="auth-brand"><img src="/converge-logo.svg" alt="Converge Medical Intelligence" className="converge-logo auth-converge-logo" /></Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="onboarding-signout" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <Link className="onboarding-signout" href="/"><ArrowLeft size={15} /> Workspace</Link>
        </div>
      </header>
      <div className="onboarding-content" style={{ maxWidth: 1180 }}>
        <div className="onboarding-heading"><span className="auth-overline">OPERATIONAL INTELLIGENCE</span><h1>Reports and analytics</h1><p>Review saved work across {hospitalName || "your hospital workspace"} and export a filtered operational snapshot.</p></div>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        <section className="onboarding-card" style={{ marginBottom: 18 }}>
          <div className="onboarding-card-title"><span className="onboarding-icon"><FileBarChart2 size={20} /></span><div><h2>Work queue summary</h2><p>Computed from the records your active hospital membership is allowed to read.</p></div><button className="onboarding-signout" style={{ marginLeft: "auto" }} disabled={loading || filtered.length === 0} onClick={exportCsv}><Download size={15} /> Export CSV</button></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 20 }}>
            {[{ label: "Matching records", value: filtered.length }, { label: "Open work", value: openCount }, { label: "High / urgent", value: urgentCount }, { label: "Overdue", value: overdueCount }].map(item => <div key={item.label} style={{ padding: 16, border: "1px solid var(--line, #e5ebef)", borderRadius: 10, background: "#15211a" }}><div style={{ color: "var(--muted, #72818d)", fontSize: 12 }}>{item.label}</div><div style={{ fontSize: 27, fontWeight: 700, marginTop: 8 }}>{loading ? "—" : item.value}</div></div>)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
            <label style={{ display: "grid", gap: 6, flex: "1 1 200px", fontSize: 12, color: "var(--muted, #72818d)" }}>Status<select value={status} onChange={event => setStatus(event.target.value)} style={{ padding: 10, border: "1px solid var(--line, #e5ebef)", borderRadius: 8, background: "#0d1511", color: "#f3f5f3" }}>{statuses.map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}</select></label>
            <label style={{ display: "grid", gap: 6, flex: "1 1 200px", fontSize: 12, color: "var(--muted, #72818d)" }}>Work type<select value={type} onChange={event => setType(event.target.value)} style={{ padding: 10, border: "1px solid var(--line, #e5ebef)", borderRadius: 8, background: "#0d1511", color: "#f3f5f3" }}><option value="all">All types</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </section>
        <section className="onboarding-card">
          <div className="onboarding-card-title"><span className="onboarding-icon"><ShieldCheck size={20} /></span><div><h2>Filtered work items</h2><p>Only operational references are included; avoid patient-identifying data in titles and summaries.</p></div></div>
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, textAlign: "left" }}>
              <thead><tr>{["Reference", "Work item", "Type", "Priority", "Status", "Due date"].map(label => <th key={label} style={{ padding: "11px 10px", color: "var(--muted, #72818d)", fontSize: 10, letterSpacing: ".08em", borderBottom: "1px solid var(--line, #e5ebef)" }}>{label.toUpperCase()}</th>)}</tr></thead>
              <tbody>{filtered.map(row => <tr key={row.id}>{[row.reference_code, row.title, typeLabels[row.item_type] ?? row.item_type, row.priority, statusLabels[row.status] ?? row.status, row.due_at ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(row.due_at)) : "—"].map((value, i) => <td key={i} style={{ padding: "13px 10px", borderBottom: "1px solid var(--line, #e5ebef)", fontSize: 12, color: i === 0 ? "#a4edc1" : "#dce5de", fontWeight: i === 1 ? 600 : 400 }}>{value}</td>)}</tr>)}</tbody>
            </table>
            {!loading && filtered.length === 0 && <p style={{ padding: 20, color: "var(--muted, #72818d)", fontSize: 13 }}>No work items match the selected filters.</p>}
            {loading && <p style={{ padding: 20, color: "var(--muted, #72818d)", fontSize: 13 }}>Loading authorised report data…</p>}
          </div>
          <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted, #72818d)", fontSize: 12, marginTop: 14 }}><ShieldCheck size={15} /> Report access follows hospital membership and Supabase row-level security. Exported CSV files leave the application and should be stored securely.</p>
        </section>
        <p className="onboarding-disclaimer">Reports are operational summaries, not clinical decision support. The current view is limited to the latest 1,000 work items and should be validated before production reporting.</p>
      </div>
    </main>
  );
}
