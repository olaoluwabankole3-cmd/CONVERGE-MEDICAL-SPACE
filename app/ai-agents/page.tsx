"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Bot, CalendarClock,
  CheckCircle2, Clock3, RefreshCw, ShieldCheck, Users, Workflow, ClipboardCheck, X,
} from "lucide-react";
import styles from "./ops.module.css";
import StaffAssignmentSelect from "./StaffAssignmentSelect";

type Insight = {
  title: string;
  priority: "high" | "medium" | "low";
  evidence: string;
  recommendation: string;
};

type TaskDraft = { sourceKey: string; sourceRecommendation: string; title: string; summary: string; priority: "low" | "medium" | "high" | "urgent"; dueDate: string; ownerUserId: string };

type OperationsData = {
  role: string;
  hospital: { id: string; name: string; city: string | null; country: string };
  generatedAt: string;
  mode: "ai" | "rules";
  note: string;
  auditRecorded: boolean;
  metrics: {
    totalRequests: number;
    openRequests: number;
    needsHospitalResponse: number;
    awaitingPatient: number;
    waitingOnHospitalOver24Hours: number;
    overdueFollowUps: number;
    highPriorityOpenWorkItems: number;
    unassignedOpenWorkItems: number;
    patientAcceptedAppointmentsNeedingConfirmation: number;
    appointmentProposalsAwaitingPatient: number;
    requestsByStatus: Record<string, number>;
    requestsByType: Record<string, number>;
  };
  analysis: {
    headline: string;
    summary: string;
    insights: Insight[];
    nextSteps: string[];
  };
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(date);
}

function localDateString() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function MetricCard({
  icon: Icon,
  labelText,
  value,
  detail,
  tone = "teal",
}: {
  icon: typeof Activity;
  labelText: string;
  value: number;
  detail: string;
  tone?: "teal" | "amber" | "rose" | "blue" | "violet";
}) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricTop}>
        <span>{labelText}</span>
        <span className={styles.metricIcon + " " + styles[tone]}><Icon size={17} /></span>
      </div>
      <strong className={styles.metricValue}>{value.toLocaleString("en-GB")}</strong>
      <span className={styles.metricDetail}>{detail}</span>
    </article>
  );
}

export default function AIAgentsPage() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [taskNotice, setTaskNotice] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/insights", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate operational insights.");
      setData(payload as OperationsData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate operational insights.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const metrics = data?.metrics;
  const canCreateTask = !!data && ["owner", "admin", "clinician", "operations"].includes(data.role);

  function draftFollowUp(insight: Insight, index: number) {
    setTaskError("");
    setTaskNotice("");
    setTaskDraft({
      sourceKey: insight.title + "-" + index,
      sourceRecommendation: insight.title,
      title: ("Follow up: " + insight.title).slice(0, 240),
      summary: "Evidence: " + insight.evidence + String.fromCharCode(10) + String.fromCharCode(10) + "Reviewed next step: " + insight.recommendation,
      priority: insight.priority === "high" ? "high" : insight.priority === "low" ? "low" : "medium",
      dueDate: "",
      ownerUserId: "",
    });
  }

  async function saveFollowUpTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !taskDraft) return;
    setSavingTask(true);
    setTaskError("");
    setTaskNotice("");
    try {
      const response = await fetch("/api/operations/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalId: data.hospital.id,
          title: taskDraft.title.trim(),
          summary: taskDraft.summary.trim(),
          sourceRecommendation: taskDraft.sourceRecommendation,
          priority: taskDraft.priority,
          dueAt: taskDraft.dueDate
            ? new Date(taskDraft.dueDate + "T23:59:00").toISOString()
            : null,
          ownerUserId: taskDraft.ownerUserId || null,
        }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to create a follow-up task.");
      const reference = payload.workItem?.reference_code;
      setTaskDraft(null);
      setTaskNotice("Created " + (reference ?? "a follow-up task") + ". It has been added to the hospital work queue and audit history.");
      await load(true);
    } catch (cause) {
      setTaskError(cause instanceof Error ? cause.message : "Unable to create a follow-up task.");
    } finally {
      setSavingTask(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}><Activity size={19} /></span>
          <span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span>
        </Link>
        <nav className={styles.headerActions}>
          <Link href="/requests" className={styles.textLink}>Patient requests</Link>
          <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Hospital workspace</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><span /> GOVERNANCE / OPERATIONS INTELLIGENCE</div>
          <h1>AI operations analyst</h1>
          <p className={styles.heroCopy}>
            A read-only view of workflow pressure points, response delays, and unassigned work.
            Recommendations are for authorised staff to review; the analyst never changes records.
          </p>
          {data?.hospital && (
            <div className={styles.hospitalLine}>
              <span className={styles.hospitalDot} />
              <strong>{data.hospital.name}</strong>
              {data.hospital.city ? <span>· {data.hospital.city}, {data.hospital.country}</span> : <span>· {data.hospital.country}</span>}
            </div>
          )}
        </div>
        <div className={styles.heroActions}>
          <div className={styles.modeBadge + " " + (data?.mode === "ai" ? styles.modeAi : styles.modeRules)}>
            {data?.mode === "ai" ? <Bot size={15} /> : <Workflow size={15} />}
            {data?.mode === "ai" ? "AI-assisted analysis" : "Rules-based baseline"}
          </div>
          <button className={styles.refreshButton} onClick={() => void load(true)} disabled={loading || refreshing}>
            <RefreshCw size={15} className={refreshing ? styles.spinning : ""} />
            {refreshing ? "Refreshing…" : "Refresh analysis"}
          </button>
        </div>
      </section>

      {error && (
        <section className={styles.errorPanel} role="alert">
          <AlertTriangle size={17} />
          <div><strong>Analysis unavailable</strong><p>{error}</p></div>
          <button onClick={() => void load(true)}>Retry</button>
        </section>
      )}

      {taskNotice && (
        <section className={styles.taskNotice} role="status">
          <CheckCircle2 size={16} /><span>{taskNotice}</span>
          <button onClick={() => setTaskNotice("")} aria-label="Dismiss notification"><X size={14} /></button>
        </section>
      )}
      {taskError && (
        <section className={styles.errorPanel} role="alert">
          <AlertTriangle size={17} /><div><strong>Task not created</strong><p>{taskError}</p></div>
          <button onClick={() => setTaskError("")}>Dismiss</button>
        </section>
      )}

      {loading && !data ? (
        <section className={styles.loadingPanel}><span className={styles.spinner} /><p>Checking operational workflow signals…</p></section>
      ) : data && metrics ? (
        <>
          <section className={styles.metricsGrid} aria-label="Operational metrics">
            <MetricCard icon={Workflow} labelText="Open requests" value={metrics.openRequests} detail={metrics.totalRequests + " total patient requests"} tone="teal" />
            <MetricCard icon={Clock3} labelText="Need hospital response" value={metrics.needsHospitalResponse} detail="Awaiting hospital-side action" tone="amber" />
            <MetricCard icon={AlertTriangle} labelText="Waiting over 24 hours" value={metrics.waitingOnHospitalOver24Hours} detail="Hospital-response states only" tone="rose" />
            <MetricCard icon={CalendarClock} labelText="Accepted, not confirmed" value={metrics.patientAcceptedAppointmentsNeedingConfirmation} detail="Staff confirmation still required" tone="violet" />
            <MetricCard icon={Clock3} labelText="Overdue follow-ups" value={metrics.overdueFollowUps} detail="Open follow-ups and tasks past due" tone="amber" />
            <MetricCard icon={Users} labelText="Unassigned open work" value={metrics.unassignedOpenWorkItems} detail={metrics.highPriorityOpenWorkItems + " open items marked high or urgent"} tone="blue" />
          </section>

          <section className={styles.analysisGrid}>
            <div className={styles.mainColumn}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.sectionKicker}>WORKFLOW REVIEW</span><h2>{data.analysis.headline}</h2></div>
                <span className={styles.readOnlyTag}><ShieldCheck size={13} /> Read-only</span>
              </div>
              <p className={styles.summary}>{data.analysis.summary}</p>

              <div className={styles.insightList}>
                {data.analysis.insights.map((insight, index) => (
                  <article className={styles.insightCard} key={insight.title + "-" + index}>
                    <div className={styles.insightTop}>
                      <span className={styles.insightNumber}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={styles.priorityBadge + " " + styles[insight.priority]}>{insight.priority} priority</span>
                    </div>
                    <h3>{insight.title}</h3>
                    <p className={styles.evidence}>{insight.evidence}</p>
                    <div className={styles.recommendation}>
                      <CheckCircle2 size={15} />
                      <p><strong>Suggested next step</strong><span>{insight.recommendation}</span></p>
                    </div>
                    {canCreateTask && taskDraft?.sourceKey !== insight.title + "-" + index && (
                      <button className={styles.draftTaskButton} onClick={() => draftFollowUp(insight, index)}>
                        <ClipboardCheck size={14} /> Draft follow-up task
                      </button>
                    )}
                    {taskDraft?.sourceKey === insight.title + "-" + index && (
                      <form className={styles.taskDraftForm} onSubmit={saveFollowUpTask}>
                        <div className={styles.taskDraftHeading}>
                          <div><strong>Review before creating</strong><span>This adds an ordinary staff task; it does not execute the recommendation.</span></div>
                          <button type="button" className={styles.closeDraftButton} onClick={() => { setTaskDraft(null); setTaskError(""); }} aria-label="Cancel task draft"><X size={15} /></button>
                        </div>
                        <label>Task title
                          <input value={taskDraft.title} onChange={event => setTaskDraft(current => current ? { ...current, title: event.target.value } : current)} required minLength={3} maxLength={240} />
                        </label>
                        <label>Task details
                          <textarea value={taskDraft.summary} onChange={event => setTaskDraft(current => current ? { ...current, summary: event.target.value } : current)} required minLength={3} maxLength={3000} rows={5} />
                        </label>
                        {data && (
                          <StaffAssignmentSelect
                            hospitalId={data.hospital.id}
                            value={taskDraft.ownerUserId}
                            onChange={ownerUserId => setTaskDraft(current => current ? { ...current, ownerUserId } : current)}
                          />
                        )}
                        <div className={styles.taskDraftFields}>
                          <label>Priority
                            <select value={taskDraft.priority} onChange={event => setTaskDraft(current => current ? { ...current, priority: event.target.value as TaskDraft["priority"] } : current)}>
                              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                            </select>
                          </label>
                          <label>Due date <span>(optional)</span>
                            <input type="date" min={localDateString()} value={taskDraft.dueDate} onChange={event => setTaskDraft(current => current ? { ...current, dueDate: event.target.value } : current)} />
                          </label>
                        </div>
                        <div className={styles.taskDraftActions}>
                          <button type="button" className={styles.cancelDraftButton} onClick={() => { setTaskDraft(null); setTaskError(""); }}>Cancel</button>
                          <button type="submit" className={styles.confirmTaskButton} disabled={savingTask || taskDraft.title.trim().length < 3 || taskDraft.summary.trim().length < 3}>
                            <ClipboardCheck size={14} /> {savingTask ? "Creating task…" : "Confirm & create task"}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <aside className={styles.sideColumn}>
              <section className={styles.sidePanel}>
                <div className={styles.sidePanelHeading}><span className={styles.sidePanelIcon}><CheckCircle2 size={17} /></span><div><h2>Recommended review order</h2><p>Suggestions only — staff decide what to do.</p></div></div>
                {data.analysis.nextSteps.length ? (
                  <ol className={styles.stepsList}>
                    {data.analysis.nextSteps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}
                  </ol>
                ) : <p className={styles.mutedText}>No next steps were returned.</p>}
              </section>

              <section className={styles.sidePanel}>
                <div className={styles.sidePanelHeading}><span className={styles.sidePanelIcon}><Activity size={17} /></span><div><h2>Request status mix</h2><p>Counts across this hospital workspace.</p></div></div>
                {Object.keys(metrics.requestsByStatus).length ? (
                  <div className={styles.statusList}>
                    {Object.entries(metrics.requestsByStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                      <div className={styles.statusRow} key={status}><span>{label(status)}</span><strong>{count}</strong></div>
                    ))}
                  </div>
                ) : <p className={styles.mutedText}>No patient request statuses to display yet.</p>}
                <Link href="/requests" className={styles.panelLink}>Open patient request queue <ArrowRight size={14} /></Link>
              </section>

              <section className={styles.privacyPanel}>
                <ShieldCheck size={17} />
                <div><strong>Data boundary</strong><p>{data.note}</p><p>Analysis access is written to the hospital audit log: {data.auditRecorded ? "recorded" : "audit write unavailable"}.</p></div>
              </section>
            </aside>
          </section>

          <footer className={styles.footer}>
            <span>Last generated {formatTime(data.generatedAt)}</span>
            <span>Administrative workflow support only. Not for diagnosis, treatment, or autonomous clinical decisions.</span>
          </footer>
        </>
      ) : null}
    </main>
  );
}
