# Converge Medical Intelligence — Hospital Deployment Gates

**Release status: NOT READY for live hospital data until the gates below are proven.** A Vercel deployment marked READY confirms deployment/build state, not hospital operational or security readiness.

## Intended first release
A hospital operations-coordination workspace for access cases, patient requests, appointment-related workflows, follow-ups, staff tasks, exceptions, aggregate operational insights, in-app notifications and audit history. It is not currently an EHR/EMR replacement and has no confirmed live external scheduling integration.

## P0 — Security and reliability
- Commit a dependency lockfile and add vulnerability scanning to CI.
- Add database authorization tests for table grants, RLS and privileged functions.
- With two synthetic hospitals, prove no user can read/update/export another hospital's records by changing IDs, query parameters or request bodies.
- Verify all server routes using Supabase service-role access enforce signed-in identity, active hospital membership, role and record scope. Service-role access bypasses RLS.
- Test each hospital role; staff invitation/removal; session expiry; password recovery; administrator MFA policy.
- Test audit integrity. Critical state changes should commit with their audit event, or raise a monitored and recoverable failure.
- Complete authenticated end-to-end tests for all primary workflows, empty/error states, duplicate submissions, date/time handling and concurrent edits.
- Configure monitoring, incident response, data-retention rules, backups and complete a documented restore test.

## P0 — Privacy and hosting
- Verify Supabase database and backup locations, application-compute location, AI providers and other subprocessors. The current Vercel deployment reports function region iad1 (Washington, D.C., USA); Supabase region is not yet verified.
- Have the hospital's DPO/legal adviser review data-controller/processor roles, Nigeria Data Protection Act obligations, cross-border transfer safeguards, DPIA where required, contracts, retention and breach response.
- Agree the initial workflow scope, lawful basis, privacy notice, user training, support and incident-escalation ownership.

## P1 — Hospital acceptance
- Test on desktop and mobile with synthetic or de-identified scenarios first.
- Have named hospital operations, IT/security and privacy owners sign off the workflows and hosting arrangement.
- Run a shadow/parallel pilot before reliance on the system for live operations; launch with minimum necessary data and a small authorised group only after written approval.
- Integrations with external EHR/EMR or scheduling systems must be designed and tested for the specific hospital, not assumed.

## Findings from the repository review
- Production deployment and core operational pages exist.
- Supabase membership checks, RLS policies and tightened direct table privileges exist, but automated cross-tenant denial tests were not found.
- CI runs lint/build; no committed dependency lockfile or automated database authorization suite was found.
- Some business changes are saved before an audit insert is attempted, so audit failure can leave a saved change with a warning.
- Authenticated production end-to-end testing and the actual Supabase region remain unverified.

**Go-live rule:** unresolved cross-tenant access defects, unverified recovery, missing audit guarantees, unresolved data-transfer arrangements or missing hospital approval keep the system in synthetic-data/pilot-preparation mode.

## Official references
- [Nigeria Data Protection Act 2023 — NDPC](https://www.ndpc.gov.ng/ndp-act-2023/)
- [NDPC registration guidance](https://ndpc.gov.ng/wp-content/uploads/2025/07/Updated-Guidance-Notice-on-Registtration-2024.pdf)
- [Next.js security update, 14 October 2026](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region)

This is an engineering checklist, not legal advice or a compliance certification.
