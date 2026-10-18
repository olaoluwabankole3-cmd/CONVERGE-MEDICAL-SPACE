# Converge Medical Intelligence — Presentation Runbook

**Purpose:** a short, honest demonstration of the current hospital operations MVP.  
**Recommended length:** 5–7 minutes.  
**Environment:** use synthetic references and test accounts only.

## Before presenting

- [ ] Open the production URL and sign in with a test account that has an **active hospital membership**.
- [ ] Confirm the overview loads real workspace data. If the page reports that Supabase is not configured, verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported) and redeploy.
- [ ] Confirm Supabase Authentication's Site URL and Redirect URLs include the deployed `/auth/callback`.
- [ ] In the correct Supabase project, verify migration `202610180006_assign_human_approved_followups.sql` and then `202610180007_notifications_and_assigned_work.sql` have been applied if demonstrating staff assignment, My Work, and notifications. Apply migration 006 before 007; do not rerun earlier schema migrations blindly.
- [ ] If the workspace is empty, add clearly synthetic records with non-identifying references (for example `DEMO-ACCESS-001`, `DEMO-FU-001`, `DEMO-TASK-001`, `DEMO-EX-001`). Do not use real patient names, dates of birth, diagnoses, contact details, or clinical narratives.
- [ ] Ensure at least one sample appointment was proposed through the existing patient-request workflow if you plan to demonstrate the appointments register.

## Suggested live walkthrough

### 1. Overview — 45 seconds

Start at the hospital dashboard. Explain that it summarises operational workload and gives authorised staff a single entry point to the hospital's queues. Point out the reference-first design and the separation of clinical identifiers from general work descriptions.

### 2. Access case → follow-up → task → exception — 2 minutes

Open each queue from the workspace navigation. Show the common interaction pattern: search, status and priority, due dates, creation, and empty/loading states. Create or update a synthetic item only if the test account is authorised. Explain that queues are separated by operational purpose while sharing a consistent interface.

### 3. Appointments — 45 seconds

Open **Appointments**. Explain that it displays the hospital's structured appointment register and related service/location information. Appointment proposals, patient responses, and confirmation decisions remain in the governed patient-request workflow; this screen does not invent a schedule or replace a hospital scheduling system.

### 4. My Work and Notifications — 60 seconds (if migrations and test accounts are ready)

Show a follow-up assigned to an eligible staff member, then sign in as the assignee to show My Work and the in-app notification. Demonstrate a status update and the corresponding audit entry. Notifications are currently in-app; do not promise email, SMS, or push delivery.

### 5. Audit history — 45 seconds

Open the audit register. Show chronological changes, search/filter controls, operational metadata, and filtered CSV export. Explain that it supports traceability within the workspace, but it is not by itself a compliance certification or full records-retention system.

### 6. Close — 30 seconds

Position Converge Medical Intelligence as a multi-hospital operations workspace for coordinating access-related work, appointment-related requests, follow-ups, tasks, exceptions, and accountable changes. Emphasise the current controlled workflow and explain that integrations, hospital-specific validation, and security review are part of rollout readiness.

## What the current build can and cannot claim

**Demonstrate:** hospital-scoped work queues, reference-first patient directory, existing patient request workflow, appointment register, reports, AI aggregate workflow insights with human-approved task creation, assigned work, in-app notifications, and audit history—provided the relevant database migrations are applied and the live account permissions support the flow.

**Be transparent about:** appointment creation/confirmation is governed through the request workflow; there is no live external EHR/EMR or hospital scheduling integration in this MVP; assignment notifications are in-app only; live end-to-end authentication, tenant isolation and production data workflows still need verification in the target Supabase project.

**Safety rule:** use synthetic data until the target hospital has completed its security, privacy, workflow and regulatory reviews.
