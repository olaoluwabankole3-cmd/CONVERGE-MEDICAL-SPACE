"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function patientDestination() {
  const params = new URLSearchParams(window.location.search);
  const next = new URL("/care/requests", window.location.origin);
  const serviceId = params.get("serviceId");
  const hospitalId = params.get("hospitalId");
  if (serviceId) next.searchParams.set("serviceId", serviceId);
  if (hospitalId) next.searchParams.set("hospitalId", hospitalId);
  return next.pathname + next.search;
}

export default function PatientLoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Patient sign-in is not configured. Please try again later.");
      setBusy(false);
      return;
    }

    try {
      const destination = patientDestination();
      if (mode === "signup") {
        if (name.trim().length < 2) throw new Error("Enter your full name to create an account.");
        const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`;
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim(), account_type: "patient" }, emailRedirectTo: callback },
        });
        if (authError) throw authError;
        if (data.session) {
          window.location.assign(destination);
          return;
        }
        setMessage("Your account has been created. Check your email to confirm your address, then sign in to continue.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        window.location.assign(destination);
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not complete sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="patient-auth-page">
      <section className="patient-auth-brand-panel">
        <Link href="/care" className="care-brand"><span className="care-brand-mark"><Activity size={20} /></span><span><strong>converge</strong><small>MEDICAL INTELLIGENCE</small></span></Link>
        <div className="patient-auth-story">
          <span className="care-eyebrow"><ShieldCheck size={14} /> PATIENT ACCESS</span>
          <h1>Your care requests, with a clearer next step.</h1>
          <p>Use one account to submit requests to participating hospitals and track replies, appointment proposals, and confirmations.</p>
          <div className="patient-auth-assurance"><ShieldCheck size={17} /><span>Your patient requests are tied to your account. Do not use this portal for emergencies.</span></div>
        </div>
        <Link className="patient-auth-back" href="/care"><ArrowLeft size={15} /> Back to service directory</Link>
      </section>
      <section className="patient-auth-form-panel">
        <div className="patient-auth-form-wrap">
          <span className="care-eyebrow">{mode === "signin" ? "WELCOME BACK" : "CREATE PATIENT ACCOUNT"}</span>
          <h2>{mode === "signin" ? "Sign in to your care space" : "Create your account"}</h2>
          <p className="patient-auth-intro">{mode === "signin" ? "Continue to your patient requests and hospital updates." : "Use an email address you can access to receive account confirmation."}</p>
          <form className="patient-auth-form" onSubmit={submit}>
            {mode === "signup" && <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={160} placeholder="Your full name" /></label>}
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="you@example.com" /></label>
            <label>Password<span className="patient-auth-password"><input type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {error && <div className="care-alert error" role="alert">{error}</div>}
            {message && <div className="care-alert success" role="status">{message}</div>}
            <button type="submit" className="care-button-primary wide" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create patient account"} {!busy && <ArrowRight size={16} />}</button>
          </form>
          <p className="patient-auth-switch">{mode === "signin" ? "New to Converge?" : "Already have a patient account?"} <button onClick={() => { setMode(value => value === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>{mode === "signin" ? "Create an account" : "Sign in"}</button></p>
          <p className="patient-auth-legal"><ShieldCheck size={14} /> Patient accounts are separate from hospital staff workspaces.</p>
          <Link href="/login" className="patient-auth-staff-link">Hospital team sign in</Link>
        </div>
      </section>
    </main>
  );
}
