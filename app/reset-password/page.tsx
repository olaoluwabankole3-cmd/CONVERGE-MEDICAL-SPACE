"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function checkRecoverySession() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (active) { setError("Account recovery is temporarily unavailable."); setChecking(false); }
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
    void checkRecoverySession();
    return () => { active = false; };
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
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
      setNotice("Password updated. Opening your workspace…");
      window.location.assign("/overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update your password. Request a new reset link and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="auth-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-converge-logo" /></Link>
        <div className="auth-story-content">
          <span className="auth-overline">ACCOUNT RECOVERY</span>
          <h1>Get back to your workspace.</h1>
          <p>Set a new password for your Converge account and continue securely.</p>
          <div className="auth-assurance"><ShieldCheck size={18} /><span>Only use a reset link that you requested yourself.</span></div>
        </div>
        <span className="auth-story-foot">Converge Medical Intelligence</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-mobile-converge-logo" /></div>
          {checking ? <><span className="auth-overline">VERIFYING LINK</span><h2>Checking your reset link…</h2><p className="auth-intro">Confirming your secure account session.</p></> :
          !hasSession ? <><span className="auth-overline">RESET LINK REQUIRED</span><h2>Request a new reset link</h2><p className="auth-intro">Your reset link may have expired. Return to sign in and request another one.</p><Link className="auth-submit" href="/login">Return to sign in <ArrowRight size={17} /></Link></> :
          <><span className="auth-overline">RESET PASSWORD</span><h2>Choose a new password</h2><p className="auth-intro">Account: {email}</p>
            <form className="auth-form" onSubmit={savePassword}>
              <label>New password<span className="auth-password"><input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter the password again" /></label>
              {error && <div className="auth-alert error" role="alert">{error}</div>}
              {notice && <div className="auth-alert success" role="status">{notice}</div>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Saving password…" : "Update password"} {!busy && <ArrowRight size={17} />}</button>
            </form>
          </>}
          <p className="auth-legal"><ShieldCheck size={14} /> Keep your password private. Converge support will never ask you to share it.</p>
          <Link href="/" className="auth-back">← Back to platform home</Link>
        </div>
      </section>
    </main>
  );
}
