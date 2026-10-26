"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy.");
      setBusy(false);
      return;
    }

    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
        });
        if (resetError) throw resetError;
        setMessage("If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.");
      } else if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding`,
          },
        });
        if (authError) throw authError;
        if (data.session) {
          window.location.assign("/onboarding");
          return;
        }
        setMessage("Account request created. Check your email to confirm your address, then return here to sign in.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        window.location.assign("/overview");
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="auth-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-converge-logo" /></Link>
        <div className="auth-story-content">
          <span className="auth-overline">CONNECTED CARE OPERATIONS</span>
          <h1>Better coordination starts with a clearer picture.</h1>
          <p>A shared operational workspace for hospital teams, built around accountable workflows and carefully governed access.</p>
          <div className="auth-assurance"><ShieldCheck size={18} /><span>Hospital access is reviewed before operational workspaces are activated.</span></div>
        </div>
        <span className="auth-story-foot">A more coordinated way to work.</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><img src="/converge-logo.svg" alt="Converge" className="converge-logo auth-mobile-converge-logo" /></div>
          <span className="auth-overline">{mode === "signin" ? "WELCOME BACK" : mode === "signup" ? "GET STARTED" : "ACCOUNT RECOVERY"}</span>
          <h2>{mode === "signin" ? "Sign in to your workspace" : mode === "signup" ? "Create your account" : "Reset your password"}</h2>
          <p className="auth-intro">{mode === "signin" ? "Use your account credentials to continue." : mode === "signup" ? "Create an account to register your hospital workspace." : "Enter your account email and we’ll send a secure password-reset link."}</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === "signup" && <label>Full name<input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label>}
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@hospital.org" /></label>
            {mode !== "forgot" && <label>Password<span className="auth-password"><input type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>}
            {error && <div className="auth-alert error" role="alert">{error}</div>}
            {message && <div className="auth-alert success" role="status">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"} {!busy && <ArrowRight size={17} />}</button>
          </form>
          {mode === "signin" && <p className="auth-switch"><button type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot password?</button></p>}
          <p className="auth-switch">{mode === "signin" ? "New to Converge?" : mode === "signup" ? "Already have an account?" : "Remember your password?"} <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); setPassword(""); }}>{mode === "signin" ? "Create an account" : "Sign in"}</button></p>
          <p className="auth-legal"><ShieldCheck size={14} /> Do not submit patient information through this sign-in page.</p>
          <Link href="/patient-login" className="auth-back">Looking for care? Open the patient portal →</Link>
          <Link href="/" className="auth-back">← Back to Medical Intelligence home</Link>
          <a href="https://ai-native-research-qfeh.vercel.app/" className="auth-back">← Main Converge platform</a>
        </div>
      </section>
    </main>
  );
}
