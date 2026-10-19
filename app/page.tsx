"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ClipboardCheck,
  Clock3, Network, ShieldCheck, Sparkles, Users
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CursorReactive } from "@/components/cursor-reactive";
import { WordParticles } from "@/components/word-particles";

const capabilities = [
  { number: "01", title: "Patient access", detail: "Keep access cases visible, assigned and moving." },
  { number: "02", title: "Requests & appointments", detail: "Coordinate service requests and appointment-related work." },
  { number: "03", title: "Follow-ups & tasks", detail: "Make ownership, next steps and due dates clear." },
  { number: "04", title: "Exceptions & audit", detail: "Surface operational issues and keep a traceable history." },
  { number: "05", title: "Governed AI insights", detail: "Use workflow signals to suggest actions for staff review." },
];

export default function MedicalLandingPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  // Keep the public landing page at / while returning signed-in users to their workspace.
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) router.replace("/overview");
    }).catch(() => {});
    return () => { active = false; };
  }, [router, supabase]);

  return (
    <main className="medical-landing" id="top">
      <CursorReactive />
      <WordParticles />

      <header className="med-header">
        <div className="med-header-inner">
          <Link href="/" className="med-brand" aria-label="Converge Medical Intelligence home">
            <span className="med-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 36 36" fill="none">
                <path d="M7 8 18 18 29 8M18 18 29 28M18 18 7 28" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="7" cy="8" r="2.7" fill="currentColor" /><circle cx="29" cy="8" r="2.7" fill="currentColor" />
                <circle cx="7" cy="28" r="2.7" fill="currentColor" /><circle cx="29" cy="28" r="2.7" fill="currentColor" />
                <circle cx="18" cy="18" r="4" fill="#e5b38e" stroke="#142119" strokeWidth="1.4" />
              </svg>
            </span>
            <span className="med-brand-copy"><strong>converge<span>.</span></strong><small>MEDICAL INTELLIGENCE</small></span>
          </Link>

          <nav className="med-main-nav" aria-label="Landing page navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#converge-platform">The Converge platform</a>
          </nav>

          <div className="med-header-actions">
            <Link href="/login" className="med-signin">Sign in</Link>
            <Link href="/login" className="med-header-cta">Hospital access <ArrowUpRight size={15} /></Link>
          </div>
        </div>
      </header>

      <section className="med-hero" aria-labelledby="med-hero-title">
        <div className="med-hero-inner">
          <div className="med-hero-copy">
            <div className="med-overline"><span className="med-live-dot" /> HOSPITAL OPERATIONS, CONNECTED</div>
            <h1 id="med-hero-title">Better care starts with <span>better coordination.</span></h1>
            <p className="med-hero-description">
              Bring access cases, patient requests, appointments and follow-ups into one clear operational picture — so hospital teams know what needs attention, who owns the next step and what has changed.
            </p>
            <div className="med-hero-actions">
              <Link href="/login" className="med-button med-button-primary">Enter the workspace <ArrowRight size={16} /></Link>
              <a href="#how-it-works" className="med-button med-button-secondary">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <div className="med-hero-assurance">
              <span className="med-assurance-icon"><ShieldCheck size={17} /></span>
              <span>Designed for accountable operations, with staff oversight built into the workflow.</span>
            </div>
          </div>

          <div className="med-visual-wrap">
            <div className="med-scene" data-cursor-reactive="scene" role="img" aria-label="Illustration of a hospital access request moving through review, coordination and follow-up">
              <div className="med-scene-halo" />
              <div className="med-scene-grid" />
              <svg className="med-scene-lines" viewBox="0 0 660 560" fill="none" aria-hidden="true">
                <path className="med-line med-line-a" d="M85 180 C165 175 190 248 275 272 S400 335 535 235" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 8" />
                <path className="med-line med-line-b" d="M90 405 C160 405 206 344 275 272 S405 145 535 235" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 8" />
                <path className="med-line med-line-c" d="M85 180 C60 262 65 345 90 405" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 9" />
                <circle className="med-signal med-signal-a" cx="0" cy="0" r="4.5" fill="#a4edc1"><animateMotion dur="5.5s" repeatCount="indefinite" path="M85 180 C165 175 190 248 275 272 S400 335 535 235" /></circle>
                <circle className="med-signal med-signal-b" cx="0" cy="0" r="4.5" fill="#e5b38e"><animateMotion dur="6.5s" repeatCount="indefinite" path="M90 405 C160 405 206 344 275 272 S405 145 535 235" /></circle>
                <circle className="med-center-node" cx="275" cy="272" r="6" fill="#bce9c9" />
              </svg>

              <div className="med-scene-topline"><span><i /> LIVE WORKFLOW PREVIEW</span><small>SYNTHETIC DATA</small></div>

              <div className="med-request-card">
                <div className="med-request-head">
                  <div className="med-request-glyph"><Activity size={18} /></div>
                  <div><span>ACCESS REQUEST · AC-204</span><strong>Access request review</strong></div>
                  <b className="med-status-pill"><i /> In review</b>
                </div>
                <div className="med-request-rule" />
                <div className="med-request-meta"><span>WORKFLOW PROGRESS</span><span>2 of 3 steps</span></div>
                <div className="med-progress"><span /></div>
                <div className="med-workflow-steps">
                  <div className="med-workflow-step is-done"><span><CheckCircle2 size={13} /></span><div><strong>Reference checked</strong><small>Access team · Completed</small></div></div>
                  <div className="med-workflow-step is-current"><span><Clock3 size={13} /></span><div><strong>Service coordination</strong><small>Next step in progress</small></div></div>
                  <div className="med-workflow-step"><span><ClipboardCheck size={13} /></span><div><strong>Follow-up assigned</strong><small>Awaiting staff action</small></div></div>
                </div>
                <div className="med-request-foot"><span><ShieldCheck size={13} /> Reference-first workflow</span><span>View record <ArrowUpRight size={12} /></span></div>
              </div>

              <div className="med-float-node med-float-node-access">
                <span className="med-node-icon med-node-mint"><Users size={15} /></span>
                <span className="med-node-copy"><strong>Access team</strong><small>Request reviewed</small></span>
                <i className="med-node-presence" />
              </div>
              <div className="med-float-node med-float-node-ops">
                <span className="med-node-icon med-node-sand"><Sparkles size={15} /></span>
                <span className="med-node-copy"><strong>Operations insight</strong><small>Next step identified</small></span>
                <i className="med-node-presence" />
              </div>
              <div className="med-float-node med-float-node-follow">
                <span className="med-node-icon med-node-blue"><CalendarDays size={15} /></span>
                <span className="med-node-copy"><strong>Care coordination</strong><small>Follow-up pending</small></span>
              </div>

              <div className="med-note-bubble med-note-one"><span>↗</span> Follow-up assigned</div>
              <div className="med-note-bubble med-note-two"><span>✓</span> Human review retained</div>

              <div className="med-live-cursor med-live-cursor-one" aria-hidden="true">
                <svg viewBox="0 0 28 34"><path d="M3 2.5 24 20l-9 .8-4.5 8.5L3 2.5Z" fill="#a4edc1" stroke="#102219" strokeWidth="2" strokeLinejoin="round" /></svg>
                <span>Access team <i>●</i></span><b />
              </div>
              <div className="med-live-cursor med-live-cursor-two" aria-hidden="true">
                <svg viewBox="0 0 28 34"><path d="M3 2.5 24 20l-9 .8-4.5 8.5L3 2.5Z" fill="#e5b38e" stroke="#39281e" strokeWidth="2" strokeLinejoin="round" /></svg>
                <span>Operations <i>●</i></span><b />
              </div>
              <div className="med-scene-caption"><span /> One workflow. Clear ownership. Traceable next steps.</div>
            </div>
          </div>
        </div>
        <div className="med-hero-ribbon"><span>ACCESS</span><i /><span>COORDINATE</span><i /><span>FOLLOW THROUGH</span><i /><span>REVIEW</span><i /><span>IMPROVE</span></div>
      </section>

      <section className="med-intro" id="how-it-works">
        <div className="med-section-inner med-intro-grid">
          <div><p className="med-eyebrow">A shared operational picture</p><h2>Less chasing updates.<br /><span>More clarity on what happens next.</span></h2></div>
          <p className="med-intro-copy">Medical Intelligence is designed to connect the operational work around care — without pretending to replace clinicians, hospital systems or the people accountable for decisions.</p>
        </div>
        <div className="med-section-inner med-principles">
          <article data-cursor-reactive="card"><span className="med-step-no">01 / CAPTURE</span><div className="med-principle-symbol"><ClipboardCheck size={22} /></div><h3>Bring the work together</h3><p>Keep access cases, requests, appointments and operational tasks visible in a consistent workspace.</p></article>
          <article data-cursor-reactive="card"><span className="med-step-no">02 / COORDINATE</span><div className="med-principle-symbol"><Network size={22} /></div><h3>Make the next step clear</h3><p>Show status, ownership, priority and due dates so work is easier to route and follow through.</p></article>
          <article data-cursor-reactive="card"><span className="med-step-no">03 / LEARN</span><div className="med-principle-symbol"><Sparkles size={22} /></div><h3>Improve with oversight</h3><p>Use aggregate operational signals to support staff review, with proposed actions approved by people.</p></article>
        </div>
      </section>

      <section className="med-capabilities" id="capabilities">
        <div className="med-section-inner">
          <div className="med-capabilities-heading"><div><p className="med-eyebrow">What it brings into view</p><h2>One workspace.<br /><span>Connected work across the day.</span></h2></div><p>Start with the operational gaps that slow teams down, then expand through a controlled hospital pilot.</p></div>
          <div className="med-capability-list">
            {capabilities.map((item) => (
              <article className="med-capability-row" key={item.number}>
                <span className="med-capability-no">{item.number}</span><h3>{item.title}</h3><p>{item.detail}</p><ArrowUpRight size={17} aria-hidden="true" />
              </article>
            ))}
          </div>
          <p className="med-capability-footnote"><ShieldCheck size={15} /> AI supports operational review; clinical decisions remain with authorised professionals.</p>
        </div>
      </section>

      <section className="med-ecosystem" id="converge-platform">
        <div className="med-section-inner med-ecosystem-grid">
          <div className="med-ecosystem-copy">
            <p className="med-eyebrow">Part of a bigger platform</p>
            <h2>Medical Intelligence is a sector workspace within <span>Converge.</span></h2>
            <p>Converge provides the shared platform foundation. Medical Intelligence applies it to hospital operations with separate hospital workspaces, role-based access and a healthcare-specific workflow.</p>
            <Link href="/login" className="med-inline-link">Explore the workspace <ArrowRight size={15} /></Link>
          </div>
          <div className="med-platform-diagram" data-cursor-reactive="panel">
            <div className="med-platform-core"><span className="med-platform-mark"><Network size={20} /></span><div><small>SHARED PLATFORM</small><strong>CONVERGE</strong><p>Identity · Governance · AI capabilities</p></div></div>
            <div className="med-platform-connector"><span /><span /><span /></div>
            <div className="med-hospital-workspaces">
              <div className="med-hospital-workspace is-featured"><span className="med-hospital-symbol"><Activity size={16} /></span><strong>Medical Intelligence</strong><small>Hospital operations workspace</small><i>Healthcare-specific</i></div>
              <div className="med-hospital-workspace"><span className="med-hospital-symbol"><Users size={16} /></span><strong>Hospital B</strong><small>Separate workspace</small></div>
              <div className="med-hospital-workspace"><span className="med-hospital-symbol"><Users size={16} /></span><strong>Hospital C</strong><small>Separate workspace</small></div>
            </div>
            <p className="med-diagram-note"><ShieldCheck size={14} /> Hospital records stay within their authorised workspace.</p>
          </div>
        </div>
      </section>

      <section className="med-close">
        <div className="med-section-inner med-close-panel" data-cursor-reactive="panel">
          <div className="med-close-orbit med-close-orbit-one" /><div className="med-close-orbit med-close-orbit-two" />
          <div className="med-close-copy">
            <p className="med-eyebrow">Start with a governed pilot</p>
            <h2>Make the work clearer.<br /><span>Keep people in control.</span></h2>
            <p>Validate real hospital workflows with a small team, synthetic or approved test data, and clear operational measures before expanding deployment.</p>
            <div className="med-close-actions"><Link href="/login" className="med-button med-button-primary">Access Converge Medical <ArrowRight size={16} /></Link><a href="#top" className="med-text-link">Back to top ↑</a></div>
          </div>
          <div className="med-close-stamp" aria-hidden="true"><span>HUMAN</span><b>+</b><span>GOVERNED</span><strong>✳</strong></div>
        </div>
      </section>

      <footer className="med-footer">
        <div className="med-footer-inner"><Link href="/" className="med-footer-brand">converge<span>.</span></Link><span>Medical Intelligence · Connected hospital operations</span><span>© {new Date().getFullYear()} Converge</span></div>
        <p className="med-footer-disclaimer">Product direction and interface preview. Hospital deployment requires technical, security, privacy and workflow validation.</p>
      </footer>
    </main>
  );
}
