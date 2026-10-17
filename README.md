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
- Hospital registrations begin in `pending` status and must be approved before operational records become accessible.\n- Hospital team page at `/team` for owners and administrators to inspect memberships, invite colleagues, update non-owner roles, and revoke hospital memberships.\n- Hospital settings at `/settings` for authorised administrators to update organisation details with an audit event.\n- Operational reports at `/reports` with status/type filters and a CSV export.\n- Patient reference directory at `/patients`, designed around hospital references and care area rather than names or clinical notes.\n- Persistent work-item creation with type, priority, external reference, due date, status transitions, and audit events.\n- GitHub Actions validation workflow for ESLint and a production build.

## Configure Supabase and Vercel

Set these variables in Vercel (Production, Preview, and Development as appropriate):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported.

Redeploy after saving environment variables. In Supabase Authentication URL Configuration, set your deployed site as the Site URL and add your deployed `/auth/callback` URL to Redirect URLs. Add localhost callback URLs for local development if needed.

Never place a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable or commit it to Git.

## Database setup

Run these migrations in order in the intended Supabase project's SQL Editor. Vercel does not execute migrations automatically.

1. `supabase/migrations/202610160001_initial_schema.sql` — core hospital, membership, work-item, audit-event tables and RLS policies.
2. `supabase/migrations/202610170001_tenant_isolation_hardening.sql` — prevents records and memberships from being moved across hospital boundaries, and validates that assigned staff belong to the same active hospital.

The second migration is additive and should be run after the initial schema. It is designed to be safe to rerun.

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

The approval console is available at `/admin/approvals`. Only an authenticated user whose email exactly matches an entry in `PLATFORM_ADMIN_EMAILS` can read or act on the queue.\n\nHospital team administration is available at `/team` after hospital activation. Hospital profile configuration is available at `/settings`, operational reports at `/reports`, and the reference-first directory at `/patients`. The patient directory requires the third migration listed above. The server-side API verifies the signed-in user’s hospital membership and owner/admin role before listing team members or creating invitations. Invitations use Supabase Auth email delivery, so configure SMTP/email delivery and the Auth redirect allowlist before testing. A hospital owner can invite administrators; hospital admins can invite non-admin roles.\n\n## Current development boundary\n\nThis build is an operational foundation, not a production clinical system. Verify email invitations, role-based permissions, tenant isolation, build output, and audit logging before using real operational or patient data. Some admin and membership flows require the service-role key on the server. Never expose that key to browser code.
