# Converge Medical Intelligence — pilot validation checklist

Use only synthetic records and test accounts during validation. Do not use real patient details until the hospital's authorised security, privacy and operational reviews are complete.

## A. Test identities

Create or use separate accounts for:
- Patient A
- Patient B
- Hospital A owner/admin
- Hospital A operations staff
- Hospital A clinician
- Hospital A reviewer (read-only for request actions)
- Hospital B owner/admin and operations staff

Hospital A and Hospital B must be separate active workspaces, each with its own synthetic services and requests.

## B. Patient-to-hospital request journey

- [ ] Patient A can register/sign in and create a request for an active, published service at Hospital A.
- [ ] The request appears in Hospital A's request inbox and has one linked operational work item.
- [ ] The request timeline shows submission, relevant messages, work item state changes, appointment activity and handovers.
- [ ] Hospital staff can start review and see the status change reflected in the request and linked work.
- [ ] Staff can ask the patient for more information; the patient sees the message and can respond.
- [ ] Patient-visible and internal staff messages are clearly distinguished.
- [ ] Hospital staff can propose an appointment; the proposal is not presented as booked or confirmed.
- [ ] Patient acceptance changes the appointment state to patient-accepted but does not confirm it.
- [ ] Only authorised hospital staff can confirm after patient acceptance; the patient sees the confirmation.
- [ ] Completion updates the request, appointment (where relevant), linked work item and audit history consistently.
- [ ] Cancellation requests and hospital decisions follow their expected state transitions and notify the patient.

## C. Tenant and patient isolation

- [ ] Patient A cannot open or enumerate Patient B's requests, profile, appointments or messages, including by changing a URL or request ID.
- [ ] Hospital A staff cannot access Hospital B requests, work items, appointments, messages, handovers, notifications or audit records.
- [ ] Patient accounts cannot read internal handover notes or handover records.
- [ ] Hospital A's service list, membership roster and operational queues contain only Hospital A records.
- [ ] Cross-hospital identifiers submitted to an API are rejected even if valid UUIDs.
- [ ] A deactivated, revoked or suspended membership no longer authorises hospital access.

## D. Role enforcement

- [ ] Owner/admin can perform only the administration actions allowed by their role.
- [ ] Clinician and operations users can perform permitted request, assignment and handover actions.
- [ ] Reviewer can inspect permitted information but is rejected for request mutations and handover creation/receipt.
- [ ] An appointment cannot be confirmed before patient acceptance.
- [ ] A handover can only be acknowledged by its named recipient.
- [ ] A staff member cannot assign or hand over work to someone outside the same active hospital.

## E. Notifications, audit and failure handling

- [ ] Assignment/handover sends a notification to the intended colleague and not to other hospitals.
- [ ] Handover creation, acknowledgement, request changes, appointment actions and completion appear in audit history.
- [ ] A failed transactional operation leaves no partial request/work/appointment/handover state.
- [ ] Unauthenticated requests return a sign-in response; invalid input returns a safe error.
- [ ] AI brief generation works with the configured provider and with provider failure/no key (rules fallback).
- [ ] AI requests exclude patient names, contact details, free-text messages, subjects and clinical notes.
- [ ] AI output requires human review and never changes operational records by itself.

## F. Device and operational checks

- [ ] Run the patient and staff journeys on a phone-sized viewport and desktop.
- [ ] Check keyboard navigation, visible focus states, labels, validation messages and loading/error states.
- [ ] Confirm date/time display matches the hospital's intended local time zone.
- [ ] Confirm backup/restore procedures, incident ownership, monitoring and account-recovery paths.
- [ ] Record defects, owner and resolution evidence. Repeat failed tests after fixes.

## Exit criteria

The pilot is not cleared for real patient data solely because a build or automated test passes. Require passing automated validation, successful authenticated role-based tests against the intended Supabase project, a hospital-approved workflow/runbook, and sign-off from the people responsible for security, privacy, operations and clinical governance.
