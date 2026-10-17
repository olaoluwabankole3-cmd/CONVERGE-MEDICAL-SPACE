"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Plus, RefreshCw, ShieldCheck, Stethoscope } from "lucide-react";

type Service = {
  id: string; hospital_id: string; service_code: string; name: string; description: string | null;
  department: string | null; is_published: boolean; is_active: boolean; display_order: number;
};
export default function HospitalServicesPage() {
  const [hospital, setHospital] = useState<{ id: string; name: string; city: string | null; country: string } | null>(null);
  const [role, setRole] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [serviceCode, setServiceCode] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [publishNow, setPublishNow] = useState(false);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/hospital/services", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load hospital services.");
      setHospital(payload.hospital ?? null);
      setRole(payload.role ?? "");
      setServices(payload.services ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hospital services.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const canManage = ["owner", "admin"].includes(role);

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hospital) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalId: hospital.id,
          serviceCode: serviceCode.trim().toUpperCase(),
          name: name.trim(),
          department: department.trim(),
          description: description.trim(),
          isPublished: publishNow,
          isActive: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create the service.");
      setNotice(payload.warning ?? (publishNow ? "Service created and published in the patient directory." : "Service saved as a draft. Publish it when the details are ready."));
      setServiceCode(""); setName(""); setDepartment(""); setDescription(""); setPublishNow(false); setShowCreate(false);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the service.");
    } finally {
      setBusy(false);
    }
  }

  async function updateService(service: Service, changes: { isPublished?: boolean; isActive?: boolean }) {
    if (!hospital) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: hospital.id, serviceId: service.id, ...changes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the service.");
      setNotice(payload.warning ?? "Service settings updated.");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="care-page hospital-services-page">
      <header className="care-topbar">
        <Link href="/" className="care-brand"><span className="care-brand-mark"><Activity size={20} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <nav className="care-header-actions"><Link href="/requests" className="care-nav-link">Patient requests</Link><Link href="/" className="care-nav-primary"><ArrowLeft size={15} /> Hospital workspace</Link></nav>
      </header>

      <section className="care-workspace-heading">
        <Link href="/" className="care-back-link"><ArrowLeft size={14} /> Overview</Link>
        <span className="care-eyebrow">HOSPITAL CONFIGURATION</span>
        <h1>Services directory</h1>
        <p>{hospital ? hospital.name : "Configure the services patients can discover and request through Converge."} Only published and active services are shown in the patient portal.</p>
      </section>

      {error && <div className="care-alert error" role="alert">{error}<button onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div>}
      {notice && <div className="care-alert success" role="status"><CheckCircle2 size={16} />{notice}</div>}

      <section className="hospital-services-panel">
        <div className="staff-request-list-heading"><div><span className="care-eyebrow">DIRECTORY CONTROLS</span><h2>Published services</h2><p>Keep names and descriptions clear so patients know what they are requesting.</p></div><button className="care-button-primary small" onClick={() => setShowCreate(value => !value)} disabled={!canManage}><Plus size={15} /> Add service</button></div>
        {!canManage && !loading && <p className="care-privacy-note"><ShieldCheck size={14} /> Your role can view services but cannot publish or change them. Ask a hospital owner or administrator.</p>}

        {showCreate && <form className="staff-action-form service-create-form" onSubmit={createService}>
          <h3>Add a hospital service</h3>
          <div className="care-form-grid"><label>Service code<input required minLength={2} maxLength={80} pattern="[A-Za-z0-9_-]+" value={serviceCode} onChange={event => setServiceCode(event.target.value.toUpperCase())} placeholder="e.g. OUTPATIENT" /></label><label>Service name<input required minLength={2} maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Outpatient consultation" /></label></div>
          <label>Department <span className="care-optional">Optional</span><input value={department} onChange={event => setDepartment(event.target.value)} maxLength={120} placeholder="e.g. Outpatient services" /></label>
          <label>Description <span className="care-optional">Optional</span><textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={1200} placeholder="Explain what the service covers and how patients should prepare." /></label>
          <label className="care-checkbox-row"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)} /> Publish immediately in the patient directory</label>
          <div><button type="button" className="care-button-secondary small" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="care-button-primary small" disabled={!canManage || busy}>{busy ? "Saving…" : "Save service"} <ArrowRight size={14} /></button></div>
        </form>}

        {loading && <div className="care-loading"><span className="care-spinner" /> Loading services…</div>}
        {!loading && services.length === 0 && <div className="care-empty"><div className="care-empty-mark"><Stethoscope size={22} /></div><h3>No services configured</h3><p>Add your first service so patients can discover it in the public directory once it is published.</p></div>}
        <div className="hospital-service-list">
          {services.map(service => <article className="hospital-service-row" key={service.id}>
            <div className="hospital-service-row-mark"><Stethoscope size={20} /></div>
            <div className="hospital-service-row-copy"><div className="hospital-service-code">{service.service_code}</div><h3>{service.name}</h3><p>{service.description || "No public description supplied."}</p><div className="hospital-service-tags"><span>{service.department || "Department not set"}</span><span className={service.is_active ? "service-status-active" : "service-status-inactive"}>{service.is_active ? "Active" : "Inactive"}</span><span className={service.is_published && service.is_active ? "service-status-published" : "service-status-draft"}>{service.is_published && service.is_active ? "Visible to patients" : service.is_published ? "Published · inactive" : "Draft · not public"}</span></div></div>
            <div className="hospital-service-row-actions">
              <button className="care-button-secondary small" onClick={() => void updateService(service, { isPublished: !service.is_published })} disabled={!canManage || busy || !service.is_active} title={service.is_published ? "Remove from public directory" : "Publish in public directory"}>{service.is_published ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}</button>
              <button className="care-button-secondary small" onClick={() => void updateService(service, { isActive: !service.is_active, isPublished: service.is_active ? false : service.is_published })} disabled={!canManage || busy}>{service.is_active ? "Deactivate" : "Activate"}</button>
            </div>
          </article>)}
        </div>
      </section>
      <div className="care-form-note-bottom"><ShieldCheck size={15} /> Publishing a service makes its name, description, department, and hospital location visible on the public patient directory. Do not put patient information in service descriptions.</div>
      <footer className="care-footer"><Link href="/" className="care-brand compact"><span className="care-brand-mark"><Activity size={17} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link><span>Service configuration · {role || "Workspace access"}</span><Link href="/audit">Audit history <ArrowRight size={13} /></Link></footer>
    </main>
  );
}
