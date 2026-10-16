# Converge Medical Intelligence

A multi-hospital operations workspace built with Next.js, TypeScript, and Supabase.

## Current milestone

- Responsive operational dashboard with synthetic demo records.
- Supabase browser client using a publishable key (or legacy anon key).
- Email/password sign-up and sign-in page at `/login`.
- Email confirmation callback at `/auth/callback`.
- Hospital onboarding form at `/onboarding`.
- Initial multi-hospital database schema for hospitals, memberships, work items, and audit events.
- Row Level Security (RLS) policies intended to scope operational records to active hospital membership.
- Hospital registrations begin in `pending` status and must be approved before operational records become accessible.

## Configure Supabase and Vercel

Set these variables in Vercel (Production, Preview, and Development as appropriate):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported.

Redeploy after saving environment variables. In Supabase Authentication URL Configuration, set your deployed site as the Site URL and add your deployed `/auth/callback` URL to Redirect URLs. Add localhost callback URLs for local development if needed.

Never place a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable or commit it to Git.

## Database setup

Run `supabase/migrations/202610160001_initial_schema.sql` once in the intended Supabase project's SQL Editor. Vercel does not execute this migration automatically.

## Local development

```bash
npm install
npm run dev
```

Create `.env.local` with the two public environment variables. Do not commit it.

## Safety boundary

This is an early development environment. The dashboard's existing demo records are not yet persistent. Do not enter real patient information until authentication, hospital approval administration, access auditing, backups, and clinical security review have been implemented and tested.


## Platform approval configuration

To enable the platform-admin hospital registration queue, configure these variables in Vercel **Project Settings → Environment Variables**:

- `PLATFORM_ADMIN_EMAILS`: comma-separated email addresses permitted to review registrations (for example, the exact email used by the platform administrator).
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role secret, used only by the server-side approval API. Obtain it from the Supabase project's API settings.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-only: **never** prefix it with `NEXT_PUBLIC_`, expose it in browser code, or commit its value to GitHub. After setting the variables, redeploy the Vercel project. If the allowlist is empty or the service key is missing, the approval API fails closed.

The approval console is available at `/admin/approvals`. Only an authenticated user whose email exactly matches an entry in `PLATFORM_ADMIN_EMAILS` can read or act on the queue.
