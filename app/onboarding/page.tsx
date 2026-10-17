"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Building2, CheckCircle2, LogOut, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AccountState = { email: string; id: string };

export default function HospitalOnboardingPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    let alive = true;
    async function loadAccount() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (alive) { setError("Supabase is not configured. Check the Vercel environment variables."); setLoading(false); }
        return;
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!alive) return;
      if (authError || !user) {
        router.replace("/login");
        return;
      }
      setAccount({ id: user.id, email: user.email ?? "" });
      setContactEmail(user.email ?? "");
      setLoading(false);
    }
    void loadAccount();
    return () => { alive = false; };
  }, [router]);

  async function registerHospital(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !account) { setError("Please sign in again and retry."); setBusy(false); return; }

    try {
      const { data: hospital, error: hospitalError } = await supabase
        .from("hospitals")
        .insert({
          name: name.trim(),
          registration_number: registrationNumber.trim() || null,
          country,
          city: city.trim() || null,
          contact_email: contactEmail.trim(),
          created_by: account.id,
          status: "pending",
        })
        .select("id")
        .single();

      if (hospitalError) throw hospitalError;

      const { error: membershipError } = await supabase.from("hospital_memberships").insert({
        hospital_id: hospital.id,
        user_id: account.id,
        role: "owner",
      });

      if (membershipError) {
        setMessage("The hospital registration was created, but the initial membership could not be added. Keep the registration details and contact your administrator before retrying.");
        throw membershipError;
      }

      setMessage("Registration submitted. Your hospital workspace is pending review and is not active yet.");
      setName(""); setRegistrationNumber(""); setCity("");
      // Take the owner to their own workspace immediately. It will show the
      // pending-approval state until a platform administrator activates it.
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hospital registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="onboarding-page"><div className="onboarding-loading">Loading your secure workspace…</div></main>;

  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <Link href="/" className="auth-brand"><span className="auth-brand-mark"><Activity size={21} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <button className="onboarding-signout" onClick={signOut}><LogOut size={16} /> Sign out</button>
      </header>
      <div className="onboarding-content">
        <div className="onboarding-heading"><span className="auth-overline">HOSPITAL WORKSPACE</span><h1>Register your hospital</h1><p>Tell us about your organisation. A registration is reviewed before the workspace can become active.</p></div>
        <div className="onboarding-grid">
          <section className="onboarding-card">
            <div className="onboarding-card-title"><span className="onboarding-icon"><Building2 size={20} /></span><div><h2>Organisation details</h2><p>Provide official details for the review process.</p></div></div>
            <form className="onboarding-form" onSubmit={registerHospital}>
              <label>Hospital or organisation name<input required minLength={2} maxLength={180} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Central Medical Centre" /></label>
              <label>Registration number <span className="optional-label">Optional</span><input value={registrationNumber} onChange={e => setRegistrationNumber(e.target.value)} placeholder="Official registration reference" /></label>
              <div className="onboarding-form-row"><label>Country<select required value={country} onChange={e => setCountry(e.target.value)}><option>Nigeria</option><option>United Arab Emirates</option><option>Ghana</option><option>Kenya</option><option>South Africa</option><option>United Kingdom</option><option>United States</option><option>Other</option></select></label><label>City<input value={city} onChange={e => setCity(e.target.value)} placeholder="City" /></label></div>
              <label>Official contact email<input type="email" required value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="admin@hospital.org" /></label>
              {error && <div className="auth-alert error" role="alert">{error}</div>}
              {message && <div className="auth-alert success" role="status"><CheckCircle2 size={17} />{message}</div>}
              <button className="auth-submit" disabled={busy} type="submit">{busy ? "Submitting…" : "Submit for review"} {!busy && <ArrowRight size={17} />}</button>
            </form>
          </section>
          <aside className="onboarding-aside">
            <div className="onboarding-aside-icon"><ShieldCheck size={23} /></div><h2>Verified before activation</h2><p>New registrations stay pending until an authorised administrator reviews them. Submitting this form does not grant access to operational hospital records.</p>
            <ul><li><CheckCircle2 size={16} /> Registration details captured</li><li><CheckCircle2 size={16} /> Administrator review required</li><li><CheckCircle2 size={16} /> Hospital-level access controls</li></ul>
            <div className="onboarding-account"><span>Signed in as</span><strong>{account?.email}</strong></div>
          </aside>
        </div>
        <p className="onboarding-disclaimer">Development milestone: use synthetic information only. Hospital registration is not yet a regulatory or clinical verification process.</p>
      </div>
    </main>
  );
}
