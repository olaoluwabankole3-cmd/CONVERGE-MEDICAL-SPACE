"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight,
  CalendarDays, CheckCircle2, ChevronDown, Clock3, FileClock,
  LayoutDashboard, Search, Settings2, ShieldCheck, Stethoscope,
  Users, WandSparkles, X, ClipboardList
} from "lucide-react";

type WorkItem = {
  id: string; title: string; reference: string; type: string; owner: string;
  priority: "High" | "Medium" | "Low"; status: string; tone: "rose" | "amber" | "blue" | "violet";
};

const initialItems: WorkItem[] = [
  { id: "AC-2048", title: "Referral documentation incomplete", reference: "Synthetic record · P-1048", type: "Access case", owner: "A. Okafor", priority: "High", status: "Needs review", tone: "rose" },
  { id: "AP-0812", title: "Appointment confirmation pending", reference: "Synthetic record · P-0812", type: "Appointment", owner: "Unassigned", priority: "Medium", status: "Awaiting response", tone: "amber" },
  { id: "FU-1176", title: "Post-visit follow-up due", reference: "Synthetic record · P-1176", type: "Follow-up", owner: "M. Bello", priority: "Medium", status: "Due today", tone: "blue" },
  { id: "EX-0309", title: "Scheduling system response delayed", reference: "Workflow reference · EX-0309", type: "Exception", owner: "Operations team", priority: "High", status: "Investigating", tone: "rose" }
];

const metrics = [
  { label: "Open access cases", value: "128", note: "12 need attention", icon: Users, tone: "blue", trend: "down" },
  { label: "Appointments today", value: "46", note: "8 awaiting confirmation", icon: CalendarDays, tone: "violet", trend: "up" },
  { label: "Follow-ups due", value: "23", note: "6 overdue", icon: Clock3, tone: "amber", trend: "down" },
  { label: "Open exceptions", value: "07", note: "2 high priority", icon: AlertCircle, tone: "rose", trend: "up" }
];

function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export default function Home() {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState("All items");
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newReference, setNewReference] = useState("");
  const [noticeVisible, setNoticeVisible] = useState(true);

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesFilter = filter === "All items" || (filter === "Unassigned" ? item.owner === "Unassigned" : item.owner === "Admin Operator");
    const query = search.toLowerCase().trim();
    const matchesSearch = !query || [item.id, item.title, item.reference, item.type, item.owner].some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  }), [items, filter, search]);

  function createCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    const item: WorkItem = {
      id: `AC-${Math.floor(3000 + Math.random() * 6000)}`,
      title: newTitle.trim(),
      reference: newReference.trim() || "Synthetic record · Reference not supplied",
      type: "Access case",
      owner: "Unassigned",
      priority: "Medium",
      status: "Draft",
      tone: "blue"
    };
    setItems((current) => [item, ...current]);
    setFilter("All items");
    setSearch("");
    setNewTitle("");
    setNewReference("");
    setShowCreate(false);
    setSelected(item);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Activity size={21} strokeWidth={2.4} /></div><div><strong>converge</strong><span>MEDICAL INTELLIGENCE</span></div></div>
        <div className="workspace-switcher"><div className="hospital-mark"><Stethoscope size={18} /></div><div className="workspace-copy"><strong>Hospital workspace</strong><span>Demo environment</span></div><ChevronDown size={16} className="muted-icon" /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#"><LayoutDashboard size={18} /> <span>Overview</span><i className="active-dot" /></a>
          <a className="nav-item" href="#work"><Users size={18} /><span>Access cases</span><b className="nav-count">12</b></a>
          <a className="nav-item" href="#work"><CalendarDays size={18} /><span>Appointments</span></a>
          <a className="nav-item" href="#work"><CheckCircle2 size={18} /><span>Follow-ups & tasks</span></a>
          <a className="nav-item" href="#attention"><AlertCircle size={18} /><span>Exceptions</span><b className="nav-count warning">7</b></a>
        </nav>
        <div className="nav-label">GOVERNANCE</div>
        <nav className="nav-list" aria-label="Governance navigation">
          <a className="nav-item" href="#ai"><WandSparkles size={18} /><span>AI agents</span></a>
          <a className="nav-item" href="#attention"><ShieldCheck size={18} /><span>Approvals</span></a>
          <a className="nav-item" href="#activity"><FileClock size={18} /><span>Audit history</span></a>
        </nav>
        <div className="sidebar-bottom"><a className="nav-item" href="#settings"><Settings2 size={18} /><span>Administration</span></a><div className="profile"><div className="avatar">AO</div><div className="profile-copy"><strong>Admin Operator</strong><span>Workspace administrator</span></div><ChevronDown size={15} className="muted-icon" /></div></div>
      </aside>

      <section className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div><div className="topbar-actions"><div className="demo-badge"><span /> Synthetic data</div><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work items" aria-label="Search work items" /></label><a className="dashboard-signin" href="/login">Sign in <ArrowRight size={14} /></a></div></header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow">THURSDAY, 16 OCTOBER 2026 <span className="eyebrow-line" /></div><h1>Good morning, Admin.</h1><p>Here’s what needs your attention across the hospital today.</p></div><button className="primary-button" onClick={() => setShowCreate(true)}><span>+</span> Create access case</button></div>
          {noticeVisible && <div className="notice"><div className="notice-icon"><ShieldCheck size={19} /></div><div><strong>Demo workspace</strong><p>This first version uses synthetic records. No real patient information or live hospital systems are connected.</p></div><button className="notice-dismiss" onClick={() => setNoticeVisible(false)} aria-label="Dismiss notice"><X size={16} /></button></div>}
          <section className="metrics-grid" aria-label="Operational summary">{metrics.map((metric) => { const Icon = metric.icon; const Trend = metric.trend === "up" ? ArrowUpRight : ArrowDownRight; return <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><div className={`metric-icon ${metric.tone}`}><Icon size={18} /></div></div><div className="metric-value">{metric.value}</div><div className={`metric-delta ${metric.tone}`}><Trend size={14} /> {metric.note}</div></article>; })}</section>
          <div className="content-grid">
            <section className="panel work-panel" id="work">
              <div className="panel-heading"><div><h2>Today’s work</h2><p>Prioritised items across your workspace</p></div><button className="text-button" onClick={() => { setFilter("All items"); setSearch(""); }}>Reset view <ArrowRight size={15} /></button></div>
              <div className="work-filters">{["All items", "Assigned to me", "Unassigned"].map((value) => <button key={value} className={`filter ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>{value}<span>{value === "All items" ? items.length : value === "Unassigned" ? items.filter(i => i.owner === "Unassigned").length : 0}</span></button>)}</div>
              <div className="table-wrap"><table><thead><tr><th>ITEM</th><th>TYPE</th><th>OWNER</th><th>PRIORITY</th><th>STATUS</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className={selected?.id === item.id ? "selected-row" : ""} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(item); }}><td><div className="item-title">{item.title}</div><div className="item-sub">{item.id} · {item.reference}</div></td><td><span className="type-label">{item.type}</span></td><td><span className={item.owner === "Unassigned" ? "unassigned" : "owner"}>{item.owner}</span></td><td><span className={`priority priority-${item.priority.toLowerCase()}`}><i />{item.priority}</span></td><td><Pill tone={item.tone}>{item.status}</Pill></td></tr>)}</tbody></table>{visibleItems.length === 0 && <div className="empty-state">No work items match this view.</div>}</div>
              <div className="panel-footer"><span>Showing {visibleItems.length} of {items.length} prototype items</span><button className="text-button" onClick={() => { setFilter("All items"); setSearch(""); }}>Open work queue <ArrowRight size={15} /></button></div>
            </section>
            <aside className="right-column">
              {selected && <section className="panel details-panel"><div className="panel-heading"><div><h2>Selected item</h2><p>Contextual record details</p></div><button className="icon-button subtle" onClick={() => setSelected(null)} aria-label="Close selected item"><X size={16} /></button></div><div className="detail-body"><Pill tone={selected.tone}>{selected.status}</Pill><h3>{selected.title}</h3><p className="detail-reference">{selected.id} · {selected.reference}</p><dl><div><dt>Work type</dt><dd>{selected.type}</dd></div><div><dt>Owner</dt><dd>{selected.owner}</dd></div><div><dt>Priority</dt><dd>{selected.priority}</dd></div></dl><p className="detail-note">Prototype only. No patient record has been accessed and no external workflow has been executed.</p></div></section>}
              <section className="panel focus-panel" id="attention"><div className="panel-heading"><div><h2>Needs attention</h2><p>Items that may need action</p></div><span className="attention-count">3</span></div><div className="attention-item"><div className="attention-symbol rose"><AlertCircle size={17} /></div><div><strong>High-priority exceptions</strong><p>2 items need operational review</p><button className="inline-link" onClick={() => { setFilter("All items"); setSearch("EX-"); }}>Review exceptions <ArrowRight size={13} /></button></div></div><div className="attention-item"><div className="attention-symbol amber"><Clock3 size={17} /></div><div><strong>Overdue follow-ups</strong><p>6 follow-ups are past their due time</p><button className="inline-link" onClick={() => { setFilter("All items"); setSearch("follow-up"); }}>Review follow-ups <ArrowRight size={13} /></button></div></div><div className="attention-item"><div className="attention-symbol violet"><ShieldCheck size={17} /></div><div><strong>Pending approvals</strong><p>1 action is waiting for an authorised reviewer</p><button className="inline-link" onClick={() => setSelected(null)}>Open approvals <ArrowRight size={13} /></button></div></div></section>
              <section className="panel activity-panel" id="activity"><div className="panel-heading"><div><h2>Recent activity</h2><p>Traceable workspace updates</p></div><button className="icon-button subtle" aria-label="Activity options"><Settings2 size={16} /></button></div><div className="activity-list"><div className="activity-entry"><div className="activity-icon"><ClipboardList size={16} /></div><div className="activity-copy"><strong>Case AC-2048 assigned for review</strong><p>Assigned by Operations desk</p><span>09:42 · Sample event</span></div></div><div className="activity-entry"><div className="activity-icon"><CalendarDays size={16} /></div><div className="activity-copy"><strong>Appointment request updated</strong><p>Confirmation still pending · AP-0812</p><span>09:28 · Sample event</span></div></div><div className="activity-entry"><div className="activity-icon"><AlertCircle size={16} /></div><div className="activity-copy"><strong>Exception EX-0309 flagged</strong><p>Scheduling response exceeded expected time</p><span>09:10 · Sample event</span></div></div></div><button className="text-button activity-link">View audit history <ArrowRight size={15} /></button></section>
              <section className="ai-card" id="ai"><div className="ai-card-top"><div className="ai-mark"><WandSparkles size={19} /></div><Pill tone="violet">Governed AI</Pill></div><h2>AI support, with oversight.</h2><p>Review agent suggestions and evidence before any consequential action is taken.</p><button className="ai-link" onClick={() => alert("Agent registry will be implemented in a later milestone. No agent has been run.")}>Explore agent activity <ArrowRight size={15} /></button></section>
            </aside>
          </div>
          <footer className="page-footer"><span><i className="footer-dot" /> Workspace prototype available</span><span>Converge Medical Intelligence <b>·</b> Prototype v0.1</span></footer>
        </div>
      </section>
      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><span className="modal-kicker">WORKSPACE ITEM</span><h2 id="create-title">Create access case</h2><p>Create a local prototype item using synthetic information.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close dialog"><X size={17} /></button></div><form onSubmit={createCase}><label>Case title<input required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Referral documents to review" autoFocus /></label><label>Reference (synthetic only)<input value={newReference} onChange={(e) => setNewReference(e.target.value)} placeholder="e.g. Demo reference P-2001" /></label><div className="form-note"><ShieldCheck size={16} /> Do not enter real patient details. This action only updates this browser session; it does not save to a server.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="primary-button">Create draft case <ArrowRight size={15} /></button></div></form></section></div>}
    </main>
  );
}
