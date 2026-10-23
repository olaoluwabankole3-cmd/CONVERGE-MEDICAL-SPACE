"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function checkInviteSession() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (active) { setError("Account setup is temporarily unavailable. Please contact your hospital administrator."); setChecking(false); }
        return;
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !user) {
        setHasSession(false);
      } else {
        setEmail(user.email ?? "");
        setHasSession(true);
      }
      setChecking(false);
    }
    void checkInviteSession();
    return () => { active = false; };
  }, []);

  async function setInitialPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Supabase is not configured."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setNotice("Password saved. Opening your hospital workspace…");
      window.location.assign("/overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to set your password. Open the invitation link again or ask your administrator to resend it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="auth-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-converge-logo" /></Link>
        <div className="auth-story-content">
          <span className="auth-overline">HOSPITAL TEAM ACCESS</span>
          <h1>Finish setting up your account.</h1>
          <p>Your hospital has invited you to a secure operational workspace. Set a password to complete your staff account.</p>
          <div className="auth-assurance"><ShieldCheck size={18} /><span>Your access is limited to the hospital and role assigned in your invitation.</span></div>
        </div>
        <span className="auth-story-foot">Converge Medical Intelligence</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-mobile-converge-logo" /></div>
          {checking ? <><span className="auth-overline">VERIFYING INVITATION</span><h2>Checking your invitation…</h2><p className="auth-intro">Confirming your secure account session.</p></> :
          !hasSession ? <><span className="auth-overline">INVITATION REQUIRED</span><h2>Open your invitation email</h2><p className="auth-intro">This page needs the secure session from your invitation link. Ask your hospital administrator to resend the invitation if it has expired.</p><Link className="auth-submit" href="/login">Go to sign in <ArrowRight size={17} /></Link></> :
          <><span className="auth-overline">SET UP YOUR ACCOUNT</span><h2>Create your password</h2><p className="auth-intro">Invited account: {email}</p>
            <form className="auth-form" onSubmit={setInitialPassword}>
              <label>New password<span className="auth-password"><input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter the password again" /></label>
              {error && <div className="auth-alert error" role="alert">{error}</div>}
              {notice && <div className="auth-alert success" role="status">{notice}</div>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Saving password…" : "Finish account setup"} {!busy && <ArrowRight size={17} />}</button>
            </form>
          </>}
          <p className="auth-legal"><ShieldCheck size={14} /> Use your work account only. Do not submit patient information here.</p>
          <Link href="/" className="auth-back">← Back to platform home</Link>
        </div>
      </section>
    </main>
  );
}
