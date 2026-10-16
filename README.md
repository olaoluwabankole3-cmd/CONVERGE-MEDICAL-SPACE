# Converge Medical Intelligence

A multi-hospital operations workspace built with Next.js, TypeScript, and Supabase.

## Current milestone

- Responsive operational dashboard with synthetic demo records.
- Supabase browser client configured for a publishable key (or legacy anon key).
- Initial multi-hospital database schema for hospital registration, memberships, work items, and audit events.
- Row Level Security (RLS) policies scope operational records to an active hospital membership.
- Hospital registrations begin in `pending` status; they must be approved before operational records become accessible.

## Configure Supabase and Vercel

Set these environment variables in Vercel (Production, Preview, and Development as appropriate):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported.

Redeploy after saving environment variables. Never place a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable or commit it to Git.

## Create the database schema

1. Open the Supabase project.
2. Open **SQL Editor** and create a new query.
3. Copy the contents of `supabase/migrations/202610160001_initial_schema.sql` into the editor and run it.
4. Confirm the tables `hospitals`, `hospital_memberships`, `work_items`, and `audit_events` exist and RLS is enabled.

The SQL migration is committed to this repository; it is not automatically executed by Vercel. Apply it once to the intended Supabase project.

## Local development

```bash
npm install
npm run dev
```

Create a local `.env.local` file with the same two environment variables. Do not commit `.env.local`.

## Important safety boundary

This is an early development environment. The dashboard currently displays synthetic prototype records; this milestone establishes the database and security foundation but does not yet make the dashboard's demo records persistent. Do not enter real patient information until authentication, hospital approval administration, access auditing, backups, and a clinical security review have been implemented and tested.
