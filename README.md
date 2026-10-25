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
- Hospital team page at `/team` for owners and administrators to inspect memberships, invite colleagues, update non-owner roles, and revoke hospital memberships.
- Hospital settings at `/settings` for authorised administrators to update organisation details with an audit event.
- Operational reports at `/reports` with status/type filters and a CSV export.
- Patient reference directory at `/patients`, designed around hospital references and care area rather than names or clinical notes.
- Persistent work-item creation with type, priority, external reference, due date, status transitions, and audit events.
- GitHub Actions validation workflow for ESLint and a production build.
- Governed operations analyst that reviews aggregate hospital workflow metrics; authorised staff can review and explicitly create a follow-up task, with task creation and audit logging committed atomically.
- Personal `/my-work` queue for assigned items, due-soon/overdue signals, and audited status updates.
- Hospital-scoped `/notifications` inbox for task assignments and status updates, with mark-read controls.

## Configure Supabase and Vercel

Set these variables in Vercel (Production, Preview, and Development as appropriate):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported.

Redeploy after saving environment variables. In Supabase Authentication URL Configuration, set your deployed site as the Site URL and add your deployed `/auth/callback` URL to Redirect URLs. Add localhost callback URLs for local development if needed.

Never place a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable or commit it to Git.

## Database setup

Run these migrations in order in the intended Supabase project's SQL Editor. Vercel does not execute migrations automatically.

1. `supabase/migrations/202610160001_initial_schema.sql` — core hospital, membership, work-item, and audit-event tables with RLS policies.
2. `supabase/migrations/202610170001_tenant_isolation_hardening.sql` — prevents records and memberships from being moved across hospital boundaries, and validates that assigned staff belong to the same active hospital.
3. `supabase/migrations/202610170002_patient_reference_registry.sql` — adds a minimal hospital-scoped patient reference directory with RLS and immutable tenant scope.
4. `supabase/migrations/202610180001_link_work_items_to_patient_references.sql` — links internal work items to active patient references within the same hospital.
5. `supabase/migrations/202610180002_restrict_client_table_privileges.sql` — removes excessive direct table/sequence privileges from `anon` and `authenticated`, and removes the broad membership-management RLS policy. Intended server-side team operations continue through the authenticated API.
6. `supabase/migrations/202610180003_patient_request_core.sql` — adds patient profiles, hospital services, canonical patient requests, structured appointment records, request links on work items, lifecycle validation, and read-only authenticated RLS policies for patient owners and hospital staff.
7. `supabase/migrations/202610180004_patient_request_transactional_workflows.sql` — adds request messages and service-role-only PostgreSQL functions for atomic patient submission, patient responses, staff review, appointment proposal/confirmation, cancellation and completion, linked work items, and audit events.
8. `supabase/migrations/202610180005_human_approved_operations_followups.sql` — adds a role-checked, service-role-only transaction that creates a staff-approved operational follow-up task and its audit event together.
9. `supabase/migrations/202610180006_assign_human_approved_followups.sql` — adds optional same-hospital staff assignment for analyst-created follow-up tasks, with membership validation and assignment audit events in the same transaction.
10. `supabase/migrations/202610180007_notifications_and_assigned_work.sql` — adds private in-app notifications for task assignment/status changes and a transactional status update for work assigned to the signed-in user.
11. `supabase/migrations/202610190001_lock_down_membership_helper_execution.sql` — removes anonymous/public execution of the `SECURITY DEFINER` hospital-membership helper functions while preserving execution required by authenticated RLS policies.
12. `supabase/migrations/202610190002_atomic_audit_for_direct_changes.sql` — writes audit records atomically for authenticated browser-side work-item and patient-reference changes, and removes direct authenticated/anonymous audit-event insert privileges.
13. `supabase/migrations/202610190003_atomic_hospital_registration_decisions.sql` — applies platform-admin approval/rejection and its audit event in one transaction.
14. `supabase/migrations/202610220001_atomic_hospital_settings_and_audit.sql` — applies hospital profile updates and their audit event atomically, restricted to the trusted server role.
15. `supabase/migrations/202610250001_contextual_request_handovers.sql` — transactional internal staff handovers with linked-work reassignment, in-app notification, acknowledgement, and audit events.

Apply these migrations in order on a fresh database. For an existing database, first verify which migrations have already been applied; do not rerun the initial schema migration against an initialized project. Vercel does not execute SQL migrations automatically. Migration 7 is required by the patient/hospital request APIs, migration 8 is required to create follow-up tasks from the operations analyst, migration 9 adds optional staff assignment, migration 13 makes hospital approval atomic, and migration 14 makes hospital settings changes and their audit events atomic. Apply applicable migrations once, in order. Run each applicable migration once in the intended Supabase project before using its workflow. The public service directory and new pages are committed to GitHub, but deployment, database RPC behaviour, authentication flows, and tenant isolation still require live verification. Use synthetic data only until that verification and the hospital's security review are complete.

## Local development

```bash
npm install
npm run dev
```

Create `.env.local` with the two public environment variables. Do not commit it.

## Database authorization tests

The repository now includes a local Supabase configuration and synthetic tenant-isolation tests under `supabase/tests/tenant_isolation.test.sql`. GitHub Actions runs `supabase test db` against a fresh local database, including cross-hospital read/write denial, audit-actor checks, audit-trigger checks, and privilege checks. A passing CI run is required evidence, but it does not replace authenticated end-to-end testing and a security review of the target hospital's actual Supabase project.

## Safety boundary

This is an early development environment. Hospital work items and the minimal patient-reference directory are persisted in Supabase, but this does not make the application production-ready for clinical use. Use synthetic references only until authentication, hospital approval, tenant isolation, role permissions, audit logging, backups, incident response, and clinical security review have been verified.


## Platform approval configuration

To enable the platform-admin hospital registration queue, configure these variables in Vercel **Project Settings → Environment Variables**:

- `PLATFORM_ADMIN_EMAILS`: comma-separated email addresses permitted to review registrations (for example, the exact email used by the platform administrator).
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role secret, used only by the server-side approval API. Obtain it from the Supabase project's API settings.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-only: **never** prefix it with `NEXT_PUBLIC_`, expose it in browser code, or commit its value to GitHub. After setting the variables, redeploy the Vercel project. If the allowlist is empty or the service key is missing, the approval API fails closed.

The approval console is available at `/admin/approvals`. Only an authenticated user whose email exactly matches an entry in `PLATFORM_ADMIN_EMAILS` can read or act on the queue.

Hospital team administration is available at `/team` after hospital activation. Hospital profile configuration is available at `/settings`, operational reports at `/reports`, and the reference-first directory at `/patients`. The patient directory requires the third migration listed above. The server-side API verifies the signed-in user’s hospital membership and owner/admin role before listing team members or creating invitations. Invitations use Supabase Auth email delivery, so configure SMTP/email delivery and the Auth redirect allowlist before testing. A hospital owner can invite administrators; hospital admins can invite non-admin roles.

## Current development boundary

This build is an operational foundation, not a production clinical system. Verify email invitations, role-based permissions, tenant isolation, build output, and audit logging before using real operational or patient data. Some admin and membership flows require the service-role key on the server. Never expose that key to browser code.
\n
## Governed operations analyst

The `/ai-agents` workspace provides read-only administrative workflow signals. A staff member with an owner, admin, clinician, or operations role may explicitly review a suggestion and convert it into an ordinary open follow-up task. Task creation is never automatic; migrations 8 and 9 must be applied first for task creation and assignment. The API verifies hospital membership, while the database function independently checks the active hospital role and atomically writes the task and audit event. It calculates counts from patient request statuses, work-item ownership/priority/due dates, and appointment states. The optional AI narrative receives **aggregate metrics only**; it is not sent patient names, phone numbers, request subjects, patient messages, or clinical notes. If the AI provider is not configured or cannot return a valid response, the page displays explicitly labelled rules-based signals instead.

To enable the optional AI-generated narrative, add these server-side environment variables in Vercel:

- `OPENAI_API_KEY` — OpenAI API key, available only to the server route.
- `OPENAI_MODEL` — optional model name; defaults to `gpt-4o-mini` in this code.

Do not prefix either variable with `NEXT_PUBLIC_`. Never commit a key to GitHub or include it in browser code. Refresh the deployment after setting the environment variables. AI recommendations are suggestions for authorised staff to review; they do not perform actions and must not be used for diagnosis, treatment, or clinical triage. Review privacy, vendor, contractual, and hospital governance requirements before enabling an external model in a real hospital environment.

In-app notifications and the `/my-work` queue require migration 10. Assignment notifications are created in the same database transaction as assignment changes. Each user can read or mark read only their own notifications within the selected active hospital. `/my-work` shows the authenticated user's assigned work; status updates are accepted only for tasks assigned to that account and generate an audit event. Notification delivery is currently in-app only—email, SMS, push, and scheduled reminder delivery are not implemented.


## Converge brand system

Medical Intelligence is a sector workspace within the wider Converge platform. Its interface follows the shared Converge design language rather than introducing a separate visual brand:

- **Foundation:** deep green-black canvas (#0b1110) with layered dark surfaces (#101917, #15211a).
- **Accent:** soft mint (#a4edc1, #8de4bb) for primary actions, active navigation, focus indicators, and brand marks.
- **Typography:** Inter-first system sans-serif stack, with the same compact, carefully tracked headings used by Converge.
- **Interface treatment:** subtle green-tinted borders, quiet surfaces, restrained glow/shadows, and readable status tones. Operational state still uses distinct warning/error colours where they convey meaning.
- **Responsive behaviour:** the existing clinical workspace, patient-access, sign-in, My Work, and Notifications layouts remain intact; this change is a visual-system alignment, not a workflow redesign.

Shared tokens and component overrides live in app/converge-brand.css; standalone My Work and Notifications pages also use the matching palette in their CSS modules.


## Operational workspaces

The authenticated workspace navigation separates operational queues by purpose:

- **Access cases** — `/work?type=access_case`
- **Appointments** — `/appointments` reads the hospital-scoped appointment register. Scheduling proposals and confirmations remain in the governed `/requests` workflow.
- **Follow-ups** — `/work?type=follow_up`
- **Tasks** — `/work?type=task`
- **Exceptions** — `/work?type=exception`
- **Audit history** — `/audit` provides a searchable, category-filtered view of the latest 500 hospital-scoped events and CSV export for the current filtered view.

The work queues share one responsive interaction pattern while showing queue-specific headings and context. Creating work records and updating their operational status follows the existing work-item permissions. Appointment records are displayed separately from appointment-related work items; this screen does not bypass the request workflow to schedule, confirm, or cancel appointments. Audit history is read-only.

## Staff invitations and account recovery

Staff access is granted by a Hospital Owner or Administrator through **Team & Access**. Staff should not register a new hospital to join an existing workspace.

For invitation and password-reset emails to reach external staff addresses:

1. Configure a custom SMTP provider in the Supabase project's Authentication settings. The built-in SMTP service is for limited testing and restricts delivery to pre-authorized addresses.
2. Set the Supabase **Site URL** to `https://converge-medical-space.vercel.app` and ensure the site is listed in Authentication URL configuration.
3. In **Authentication → Email Templates**, configure these templates to use the server-side token-hash confirmation route. Keep the requested paths exactly as shown:
   - **Invite user**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/accept-invite`
   - **Reset password**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   - **Confirm signup**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
4. In each template, use the corresponding URL above as the email action link. Keep the default subject or customize it to match Converge branding.
5. Check Supabase Auth logs if a send fails. After SMTP is configured, retry the invitation from Team & Access; an unconfirmed account left by an earlier failed invitation can be invited again.

New invitees use the invitation link to set their first password at `/accept-invite`. Existing confirmed accounts are added to the hospital without a new invite email; they sign in using their existing password or use **Forgot password?**. Password-reset emails use `/reset-password`.


## Contextual staff handovers

The Coordination Room can transfer a linked operational work item to another active member of the same hospital. A handover captures an internal-only note, reassigns the work item, triggers the existing in-app assignment notification, and writes audit events in one transaction. The recipient can acknowledge receipt from the linked patient request; the acknowledgement and internal activity entry are also transactional. Handover notes are never shown in the patient portal. Apply migration 15 after the existing notification/assignment migration before enabling handovers in the target Supabase project. Until that migration is applied, the existing patient request workflow remains available and the handover controls are disabled.
