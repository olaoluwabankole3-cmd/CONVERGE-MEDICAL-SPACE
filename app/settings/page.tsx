"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Building2, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Hospital = { id: string; name: string; registration_number: string | null; country: string; city: string | null; contact_email: string; status: string; created_at: string; updated_at: string };

export default function HospitalSettingsPage() {
  const router = useRouter();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [name, setName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      if (!membership) throw new Error("No active hospital membership was found for this account.");
      const response = await fetch(`/api/hospital/settings?hospitalId=${encodeURIComponent(membership.hospital_id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load hospital settings.");
      const item = payload.hospital as Hospital;
      setHospital(item); setName(item.name); setRegistrationNumber(item.registration_number ?? "");
      setCountry(item.country); setCity(item.city ?? ""); setContactEmail(item.contact_email);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hospital settings.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hospital) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/hospital/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalId: hospital.id, name, registration_number: registrationNumber, country, city, contact_email: contactEmail }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save hospital settings.");
      setHospital(payload.hospital); setNotice(payload.warning ?? "Hospital details have been saved and the change recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save hospital settings.");
    } finally { setSaving(false); }
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
      <div className="onboarding-content" style={{ maxWidth: 960 }}>
        <div className="onboarding-heading"><span className="auth-overline">WORKSPACE CONFIGURATION</span><h1>Hospital settings</h1><p>Keep your organisation details current. Updates are restricted to hospital owners and administrators and recorded in the audit history.</p></div>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        {notice && <div className="auth-alert success" role="status"><CheckCircle2 size={17} /> {notice}</div>}
        <section className="onboarding-card">
          <div className="onboarding-card-title"><span className="onboarding-icon"><Building2 size={20} /></span><div><h2>Organisation profile</h2><p>{hospital ? `${hospital.name} · ${hospital.status}` : "Loading hospital details"}</p></div></div>
          {loading ? <p style={{ color: "var(--muted, #72818d)" }}>Loading authorised hospital settings…</p> : hospital && <form className="onboarding-form" onSubmit={save}>
            <label>Hospital or organisation name<input required minLength={2} maxLength={180} value={name} onChange={event => setName(event.target.value)} /></label>
            <label>Official registration number<input maxLength={120} value={registrationNumber} onChange={event => setRegistrationNumber(event.target.value)} placeholder="Registration reference" /></label>
            <div className="onboarding-form-row"><label>Country<input required maxLength={100} value={country} onChange={event => setCountry(event.target.value)} /></label><label>City<input maxLength={120} value={city} onChange={event => setCity(event.target.value)} /></label></div>
            <label>Official contact email<input type="email" required maxLength={254} value={contactEmail} onChange={event => setContactEmail(event.target.value)} /></label>
            <div className="form-note"><ShieldCheck size={16} /> Hospital identity changes are audited. These details do not replace independent regulatory verification.</div>
            <button className="auth-submit" type="submit" disabled={saving || hospital.status !== "active"}>{saving ? "Saving changes…" : hospital.status !== "active" ? "Available after approval" : "Save hospital settings"} <ArrowRight size={16} /></button>
          </form>}
        </section>
        {hospital && <p className="onboarding-disclaimer">Workspace ID: {hospital.id}<br />Created {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(hospital.created_at))} · Last updated {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(hospital.updated_at))}</p>}
      </div>
    </main>
  );
}
