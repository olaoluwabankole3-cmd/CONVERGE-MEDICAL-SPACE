# Converge Medical Intelligence — Hospital Deployment Gates

**Release decision: NOT YET APPROVED for live patient data.** A green Vercel deployment proves that a build was deployed; it does not prove clinical-operational suitability, security in the live Supabase project, or legal approval.

## Initial release scope

The intended first release is a hospital operations-coordination workspace for patient access requests, appointment-related workflows, follow-ups, staff tasks, exceptions, aggregate operational insights, in-app notifications and audit history.

It is **not an EHR/EMR replacement**, and there is no confirmed live external EHR/EMR or hospital scheduling integration. Scheduling proposals and staff confirmation must continue to follow the hospital's agreed scheduling process.

## P0 — Release blockers

### 1. Tenant isolation and access control

- Run the committed Supabase database test suite and preserve passing evidence from CI.
- In a staging project, create two synthetic hospitals and test with separate owner, admin, clinician, operations and reviewer accounts.
- Prove that one hospital cannot read, modify, enumerate or export another hospital's records by changing IDs, URL parameters, request bodies, filters or API calls.
- Test the privileged server routes separately. Service-role database access bypasses row-level security, so each route must establish the caller's identity, active membership, role and record scope before using it.
- Test account invitation, removal, suspended/pending hospitals, session expiry, password recovery and the hospital's administrator MFA policy.

### 2. Database migrations and audit integrity

- Verify the actual Supabase project has the repository migrations applied in order, rather than assuming that committing SQL to GitHub changes the live database.
- The hospital registration decision route now uses `decide_hospital_registration` so approval/rejection and its audit event are committed in one database transaction. Apply `supabase/migrations/202610190003_atomic_hospital_registration_decisions.sql` to Supabase before using that route.
- Confirm migrations `202610180006_assign_human_approved_followups.sql`, `202610180007_notifications_and_assigned_work.sql`, `202610190001_lock_down_membership_helper_execution.sql`, `202610190002_atomic_audit_for_direct_changes.sql`, and `202610190003_atomic_hospital_registration_decisions.sql` are applied in sequence where not already applied. Do not rerun schema migrations blindly.
- Test that failed critical writes cannot leave an unaudited state change. Verify actor attribution and audit coverage for requests, appointments, membership changes, patient-reference changes and hospital decisions.

### 3. Hosting, privacy and data governance

- Confirm the database's actual region in Supabase and record the application-compute region in Vercel. The reviewed Vercel deployment reported function region `iad1` (Washington, D.C., USA); the Supabase region has not been verified.
- Choose and document hosting locations, backups, AI providers and other subprocessors with the hospital. Region selection is a data-location decision, not proof of regulatory compliance.
- Have the hospital's privacy lead/DPO and legal adviser review Nigeria Data Protection Act 2023 obligations, controller/processor roles, lawful basis, privacy notices, data minimisation, retention/deletion, DPIA requirements where applicable, cross-border transfers, contracts, data-subject requests and breach notification.
- Agree what information may be stored in work-item summaries. Keep patient identifiers and clinical narratives to the minimum required, and never send identifiable health data to an AI provider unless the hospital has explicitly approved the use, processing terms and safeguards.

### 4. Reliability and operational ownership

- Run authenticated end-to-end tests for primary workflows, including empty/error states, duplicate submissions, invalid status transitions, timezone handling and concurrent edits.
- Confirm backup frequency and retention, and complete a documented restore test.
- Configure production error monitoring, audit/operational alerting, incident response, access review, data retention, support escalation, and named technical and hospital owners.
- Verify Supabase Auth redirect URLs, environment variables, rate limiting where appropriate, and that no service-role key is exposed to client-side code.
- Keep the lockfile reproducible and run dependency-audit, lint, build and database tests in CI.

## P1 — Hospital acceptance

- Test desktop and mobile workflows with synthetic or de-identified scenarios.
- Have named hospital operations, IT/security, privacy and service owners sign off the scope, access model, hosting arrangement, workflows, training and support plan.
- Run a time-boxed sandbox and shadow/parallel pilot before reliance on the system for live operations.
- Begin any live-data pilot only after written hospital approval, legal/privacy review, security test evidence, restoration evidence and an agreed incident process.
- Design each EHR/EMR, laboratory, messaging or scheduling integration for the specific hospital. Do not imply that such integrations already exist.

## Recommended rollout sequence

1. **Internal staging:** synthetic data only; prove CI, tenant isolation, role boundaries and core workflow tests.
2. **Hospital sandbox:** configure the hospital's roles, queues, services and workflow policies; use synthetic/de-identified records.
3. **Shadow pilot:** compare Converge's operational queues against the hospital's existing process without making Converge the system of record.
4. **Limited live pilot:** enable minimum necessary data and a small authorised staff group only after written sign-off; monitor daily and keep a documented fallback process.
5. **Broader rollout:** expand departments or additional hospitals only after pilot acceptance, support readiness and integration/security review.

## Current engineering evidence

- The app is deployed on Vercel and the repository has automated application validation and Supabase database-test workflows.
- The application includes RLS and hospital-membership checks, explicit client-table privilege restrictions, a tenant-isolation database test suite and append-only audit protections.
- Critical approval/rejection operations have been moved to a transactional database function so a missing audit insert rolls back the decision.
- A successful build, passing database tests, and a deployed URL are necessary gates—not, individually or together, a hospital compliance certification or proof of a successful authenticated end-to-end production test.

## Go-live rule

Keep the platform in synthetic-data or approved sandbox mode if cross-tenant access tests, live authentication and role checks, audit integrity, backup restoration, data-location/transfer review, or hospital acceptance remain unresolved.

## References

- Nigeria Data Protection Commission: [Nigeria Data Protection Act 2023](https://www.ndpc.gov.ng/ndp-act-2023/)
- Supabase: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Project regions and data residency](https://supabase.com/docs/guides/platform/regions)
- Vercel: [Configuring Function regions](https://vercel.com/docs/functions/configuring-functions)
- OWASP: [Application Security Verification Standard](https://github.com/OWASP/ASVS)

This checklist is an engineering release gate, not legal advice or a compliance certification.
