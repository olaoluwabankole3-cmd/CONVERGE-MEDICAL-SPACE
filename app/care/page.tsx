"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Building2, CalendarDays, RefreshCw, Search, ShieldCheck, Stethoscope } from "lucide-react";

type Service = {
  id: string;
  serviceCode: string;
  name: string;
  description: string | null;
  department: string | null;
  hospital: { id: string; name: string; city: string | null; country: string } | null;
};

export default function CareDirectoryPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/patient/services", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load hospital services.");
      setServices(payload.services ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the service directory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return services;
    return services.filter(service =>
      [service.name, service.description ?? "", service.department ?? "",
        service.hospital?.name ?? "", service.hospital?.city ?? ""]
        .some(value => value.toLowerCase().includes(term)),
    );
  }, [services, search]);

  return (
    <main className="care-page">
      <header className="care-topbar">
        <Link href="/care" className="care-brand">
          <span className="care-brand-mark"><Activity size={20} /></span>
          <span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span>
        </Link>
        <nav className="care-header-actions" aria-label="Patient navigation">
          <Link href="/care/requests" className="care-nav-link">My requests</Link>
          <Link href="/patient-login" className="care-nav-primary">Patient sign in <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="care-hero">
        <div className="care-hero-copy">
          <span className="care-eyebrow"><ShieldCheck size={14} /> PATIENT ACCESS</span>
          <h1>A clearer path to your next step in care.</h1>
          <p>Explore services offered by participating hospitals, send a request, and follow the response in one place.</p>
          <div className="care-hero-actions">
            <a className="care-button-primary" href="#services">Explore services <ArrowRight size={16} /></a>
            <Link className="care-button-secondary" href="/care/requests">Track a request</Link>
          </div>
          <div className="care-hero-note"><ShieldCheck size={15} /> Appointment requests are reviewed and confirmed by the hospital.</div>
        </div>
        <div className="care-hero-panel" aria-label="How the request process works">
          <div className="care-panel-top"><span>YOUR CARE REQUEST</span><span className="care-live-dot">Connected workflow</span></div>
          <div className="care-step"><span className="care-step-number">01</span><div><strong>Choose a service</strong><p>Start with a participating hospital.</p></div><span className="care-step-check">✓</span></div>
          <div className="care-step"><span className="care-step-number">02</span><div><strong>Hospital reviews</strong><p>Your request enters their operations queue.</p></div><span className="care-step-check">↗</span></div>
          <div className="care-step"><span className="care-step-number">03</span><div><strong>Know what happens next</strong><p>Track the response, proposal, or next step.</p></div><span className="care-step-check">○</span></div>
          <div className="care-panel-footer"><span><Building2 size={15} /> Participating hospitals only</span><span>Secure access</span></div>
        </div>
      </section>

      <section id="services" className="care-services-section">
        <div className="care-section-heading">
          <div><span className="care-eyebrow">PARTICIPATING HOSPITALS</span><h2>Explore available services</h2><p>Only services published by an active participating hospital appear here.</p></div>
          <label className="care-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search services or hospitals" /></label>
        </div>

        {error && <div className="care-alert error" role="alert">{error}<button onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div>}
        {loading && <div className="care-loading"><span className="care-spinner" /> Loading participating services…</div>}
        {!loading && !error && visible.length === 0 && (
          <div className="care-empty">
            <div className="care-empty-mark"><Stethoscope size={22} /></div>
            <h3>{services.length ? "No matching services" : "The directory is being prepared"}</h3>
            <p>{services.length ? "Try another search term." : "Participating hospitals will appear here when they publish their services. You can still sign in to view or manage existing requests."}</p>
            {services.length === 0 && <Link href="/patient-login">Patient sign in <ArrowRight size={14} /></Link>}
          </div>
        )}
        <div className="care-service-grid">
          {visible.map(service => (
            <article className="care-service-card" key={service.id}>
              <div className="care-service-icon"><Stethoscope size={21} /></div>
              <div className="care-service-meta">{service.department || "Hospital service"} <span>·</span> {service.hospital?.city || service.hospital?.country || "Participating hospital"}</div>
              <h3>{service.name}</h3>
              <p>{service.description || "Contact the hospital through Converge to ask about this service and the next available step."}</p>
              <div className="care-service-hospital"><Building2 size={15} /><span>{service.hospital?.name ?? "Participating hospital"}</span></div>
              <div className="care-service-footer">
                <span><CalendarDays size={14} /> Request an appointment or service</span>
                <Link href={`/patient-login?serviceId=${encodeURIComponent(service.id)}&hospitalId=${encodeURIComponent(service.hospital?.id ?? "")}`} aria-label={`Request ${service.name}`}><ArrowRight size={18} /></Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="care-footer"><Link href="/care" className="care-brand compact"><span className="care-brand-mark"><Activity size={17} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link><span>Coordinate your next step with a participating hospital.</span><Link href="/login">Hospital team sign in</Link></footer>
    </main>
  );
}
