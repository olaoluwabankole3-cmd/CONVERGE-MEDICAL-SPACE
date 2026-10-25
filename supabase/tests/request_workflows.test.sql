begin;
select plan(78);

-- This suite uses synthetic users, hospitals, requests and appointments only.
-- All rows are rolled back at the end. It exercises the database contracts
-- used by the patient portal and hospital Coordination Room.

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('61111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'workflow-owner-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('62222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'workflow-ops-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('63333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'workflow-reviewer-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('64444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'workflow-owner-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('65555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'workflow-patient-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'workflow-patient-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('67777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'workflow-ops-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.hospitals (id, name, contact_email, status, created_by)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'Workflow Test Hospital A', 'workflow-a@example.invalid', 'active', '61111111-1111-4111-8111-111111111111'),
  ('bbbb2222-2222-4222-8222-222222222222', 'Workflow Test Hospital B', 'workflow-b@example.invalid', 'active', '64444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.hospital_memberships (hospital_id, user_id, role)
values
  ('aaaa1111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111', 'owner'),
  ('aaaa1111-1111-4111-8111-111111111111', '62222222-2222-4222-8222-222222222222', 'operations'),
  ('aaaa1111-1111-4111-8111-111111111111', '63333333-3333-4333-8333-333333333333', 'reviewer'),
  ('bbbb2222-2222-4222-8222-222222222222', '64444444-4444-4444-8444-444444444444', 'owner'),
  ('bbbb2222-2222-4222-8222-222222222222', '67777777-7777-4777-8777-777777777777', 'operations')
on conflict (hospital_id, user_id) do nothing;

insert into public.hospital_services (id, hospital_id, service_code, name, is_published, is_active, created_by)
values
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa1111-1111-4111-8111-111111111111', 'SYN-APPT-A', 'Synthetic Appointment Service A', true, true, '61111111-1111-4111-8111-111111111111'),
  ('bbbb0000-0000-4000-8000-000000000002', 'bbbb2222-2222-4222-8222-222222222222', 'SYN-APPT-B', 'Synthetic Appointment Service B', true, true, '64444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

-- Direct browser grants and service-role-only workflow RPCs.
select ok(not has_function_privilege('anon', 'public.submit_patient_request(uuid,uuid,uuid,public.patient_request_type,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Anonymous callers cannot submit patient requests directly');
select ok(not has_function_privilege('authenticated', 'public.submit_patient_request(uuid,uuid,uuid,public.patient_request_type,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Authenticated browser clients cannot bypass the patient request API');
select ok(has_function_privilege('service_role', 'public.submit_patient_request(uuid,uuid,uuid,public.patient_request_type,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Trusted server can submit a patient request');
select ok(not has_function_privilege('anon', 'public.patient_respond_to_request(uuid,uuid,text,text)', 'execute'), 'Anonymous callers cannot respond to requests directly');
select ok(not has_function_privilege('authenticated', 'public.patient_respond_to_request(uuid,uuid,text,text)', 'execute'), 'Patient response RPC is not callable by browser clients');
select ok(has_function_privilege('service_role', 'public.patient_respond_to_request(uuid,uuid,text,text)', 'execute'), 'Trusted server can submit authenticated patient responses');
select ok(not has_function_privilege('anon', 'public.staff_handle_patient_request(uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Anonymous callers cannot run hospital request actions');
select ok(not has_function_privilege('authenticated', 'public.staff_handle_patient_request(uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Hospital workflow RPC cannot be called directly by browser clients');
select ok(has_function_privilege('service_role', 'public.staff_handle_patient_request(uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text)', 'execute'), 'Trusted server can run hospital request actions');
select ok(not has_table_privilege('authenticated', 'public.patient_requests', 'insert'), 'Browser cannot insert patient request rows directly');
select ok(not has_table_privilege('authenticated', 'public.patient_requests', 'update'), 'Browser cannot mutate patient request lifecycle directly');
select ok(not has_table_privilege('authenticated', 'public.appointments', 'insert'), 'Browser cannot create appointment rows directly');
select ok(not has_table_privilege('authenticated', 'public.request_messages', 'insert'), 'Browser cannot inject request messages directly');
select ok(not has_table_privilege('anon', 'public.patient_requests', 'select'), 'Anonymous callers cannot read patient requests');
select ok(not has_table_privilege('anon', 'public.request_messages', 'select'), 'Anonymous callers cannot read patient request messages');
select ok(not has_table_privilege('authenticated', 'public.request_handovers', 'insert'), 'Browser cannot create handover rows directly');
select ok(not has_function_privilege('authenticated', 'public.record_patient_request_handover(uuid,uuid,uuid,uuid,uuid,text)', 'execute'), 'Browser cannot bypass the handover API');
select ok(has_function_privilege('service_role', 'public.record_patient_request_handover(uuid,uuid,uuid,uuid,uuid,text)', 'execute'), 'Trusted server can run the handover transaction');
select ok(not has_function_privilege('authenticated', 'public.acknowledge_patient_request_handover(uuid,uuid)', 'execute'), 'Browser cannot bypass the handover acknowledgement API');
select ok(has_function_privilege('service_role', 'public.acknowledge_patient_request_handover(uuid,uuid)', 'execute'), 'Trusted server can acknowledge a handover after verifying the recipient');

-- Establish two independent patient requests through the same RPC used by the app.
set local role service_role;
select set_config(
  'test.workflow_request_a',
  public.submit_patient_request(
    '65555555-5555-4555-8555-555555555555',
    'aaaa1111-1111-4111-8111-111111111111',
    'aaaa0000-0000-4000-8000-000000000001',
    'appointment',
    'Synthetic appointment request A',
    'Synthetic patient message A',
    null, null, 'Synthetic Patient A', null
  )->>'id',
  true
);
select set_config(
  'test.workflow_request_b',
  public.submit_patient_request(
    '66666666-6666-4666-8666-666666666666',
    'bbbb2222-2222-4222-8222-222222222222',
    'bbbb0000-0000-4000-8000-000000000002',
    'appointment',
    'Synthetic appointment request B',
    'Synthetic patient message B',
    null, null, 'Synthetic Patient B', null
  )->>'id',
  true
);
select set_config('test.workflow_work_a', (select id::text from public.work_items where patient_request_id = current_setting('test.workflow_request_a')::uuid limit 1), true);
select set_config('test.workflow_work_b', (select id::text from public.work_items where patient_request_id = current_setting('test.workflow_request_b')::uuid limit 1), true);
reset role;

select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 'submitted', 'Patient A request begins in submitted state');
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_b')::uuid), 'submitted', 'Patient B request begins in submitted state');
select is((select count(*)::integer from public.work_items where patient_request_id = current_setting('test.workflow_request_a')::uuid and hospital_id = 'aaaa1111-1111-4111-8111-111111111111'), 1, 'Submission creates exactly one linked operational work item');
select is((select count(*)::integer from public.audit_events where entity_type = 'patient_request' and entity_id = current_setting('test.workflow_request_a') and action = 'patient_request_submitted'), 1, 'Submission is recorded in the audit trail');
select is((select count(*)::integer from public.request_messages where patient_request_id = current_setting('test.workflow_request_a')::uuid and visibility = 'patient_visible' and body = 'Synthetic patient message A'), 1, 'Initial patient message is stored as patient-visible');

-- These RPCs run as trusted server only, but their actor/tenant arguments must still be validated.
set local role service_role;
select throws_ok(
  $$select public.staff_handle_patient_request('63333333-3333-4333-8333-333333333333', 'aaaa1111-1111-4111-8111-111111111111', current_setting('test.workflow_request_a')::uuid, 'start_review', '', null::timestamptz, null::timestamptz, null, null)$$,
  'P0001', 'Active hospital staff permission is required',
  'Reviewer cannot execute a mutating request action'
);
select throws_ok(
  $$select public.staff_handle_patient_request('64444444-4444-4444-8444-444444444444', 'aaaa1111-1111-4111-8111-111111111111', current_setting('test.workflow_request_a')::uuid, 'start_review', '', null::timestamptz, null::timestamptz, null, null)$$,
  'P0001', 'Active hospital staff permission is required',
  'Staff from another hospital cannot mutate this request'
);
select throws_ok(
  $$select public.patient_respond_to_request('66666666-6666-4666-8666-666666666666', current_setting('test.workflow_request_a')::uuid, 'send_message', 'Attempt to read another patient request')$$,
  'P0001', 'Request not found',
  'A patient cannot respond to another patient’s request'
);

-- Patient B's appointment follows the same staff proposal path so both tenants have comparable records.
select public.staff_handle_patient_request(
  '64444444-4444-4444-8444-444444444444', 'bbbb2222-2222-4222-8222-222222222222',
  current_setting('test.workflow_request_b')::uuid, 'start_review', '',
  null::timestamptz, null::timestamptz, null, null
);
select public.staff_handle_patient_request(
  '64444444-4444-4444-8444-444444444444', 'bbbb2222-2222-4222-8222-222222222222',
  current_setting('test.workflow_request_b')::uuid, 'propose_appointment', 'Synthetic proposal B',
  now() + interval '5 days', now() + interval '5 days 1 hour', 'Synthetic location B', 'Synthetic instructions B'
);
reset role;
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_b')::uuid), 'appointment_proposed', 'Hospital B can move its own request through proposal');
select is((select status::text from public.appointments where patient_request_id = current_setting('test.workflow_request_b')::uuid), 'proposed', 'Appointment proposal remains unconfirmed before patient acceptance');
select is((select count(*)::integer from public.request_messages where patient_request_id = current_setting('test.workflow_request_b')::uuid and visibility = 'patient_visible' and body like 'The hospital proposed an appointment%'), 1, 'Appointment proposal creates a patient-visible message');

-- Review, linked work, staff handover, assignment notification, recipient acknowledgement.
set local role service_role;
select public.staff_handle_patient_request(
  '61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111',
  current_setting('test.workflow_request_a')::uuid, 'start_review', '',
  null::timestamptz, null::timestamptz, null, null
);
reset role;
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 'under_review', 'Hospital review updates request lifecycle');
select is((select status::text from public.work_items where id = current_setting('test.workflow_work_a')::uuid), 'in_progress', 'Starting review updates linked work state');
select is((select count(*)::integer from public.audit_events where entity_id = current_setting('test.workflow_request_a') and action = 'patient_request_review_started'), 1, 'Starting review creates an audit event');

set local role service_role;
select set_config(
  'test.workflow_handover_a',
  public.record_patient_request_handover(
    '61111111-1111-4111-8111-111111111111',
    'aaaa1111-1111-4111-8111-111111111111',
    current_setting('test.workflow_request_a')::uuid,
    current_setting('test.workflow_work_a')::uuid,
    '62222222-2222-4222-8222-222222222222',
    'Synthetic handover A: confirm the next administrative step.'
  )->>'id',
  true
);
select set_config(
  'test.workflow_handover_b',
  public.record_patient_request_handover(
    '64444444-4444-4444-8444-444444444444',
    'bbbb2222-2222-4222-8222-222222222222',
    current_setting('test.workflow_request_b')::uuid,
    current_setting('test.workflow_work_b')::uuid,
    '67777777-7777-4777-8777-777777777777',
    'Synthetic handover B: confirm the next administrative step.'
  )->>'id',
  true
);
reset role;
select is((select status from public.request_handovers where id = current_setting('test.workflow_handover_a')::uuid), 'pending', 'Handover A begins pending acknowledgement');
select is((select owner_id from public.work_items where id = current_setting('test.workflow_work_a')::uuid), '62222222-2222-4222-8222-222222222222'::uuid, 'Handover reassigns linked work to the selected colleague');
select is((select count(*)::integer from public.user_notifications where hospital_id = 'aaaa1111-1111-4111-8111-111111111111' and recipient_user_id = '62222222-2222-4222-8222-222222222222' and entity_id = current_setting('test.workflow_work_a')), 1, 'Handover assignment creates an in-app notification');
select is((select count(*)::integer from public.audit_events where entity_type = 'request_handover' and entity_id = current_setting('test.workflow_handover_a') and action = 'request_handover_created'), 1, 'Handover creation is audited');
select is((select status from public.request_handovers where id = current_setting('test.workflow_handover_b')::uuid), 'pending', 'Hospital B has its own separate handover');
select is((select owner_id from public.work_items where id = current_setting('test.workflow_work_b')::uuid), '67777777-7777-4777-8777-777777777777'::uuid, 'Hospital B handover only reassigns Hospital B work');

set local role service_role;
select throws_ok(
  $$select public.record_patient_request_handover('61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111', current_setting('test.workflow_request_a')::uuid, current_setting('test.workflow_work_a')::uuid, '63333333-3333-4333-8333-333333333333', 'Invalid reviewer recipient for this handover')$$,
  'P0001', 'The receiving staff member must have active membership in this hospital',
  'Read-only reviewer cannot receive an operational handover'
);
select throws_ok(
  $$select public.acknowledge_patient_request_handover('61111111-1111-4111-8111-111111111111', current_setting('test.workflow_handover_a')::uuid)$$,
  'P0001', 'Only the assigned recipient can acknowledge this handover',
  'Only the named recipient can acknowledge a handover'
);
select public.acknowledge_patient_request_handover('62222222-2222-4222-8222-222222222222', current_setting('test.workflow_handover_a')::uuid);
reset role;
select is((select status from public.request_handovers where id = current_setting('test.workflow_handover_a')::uuid), 'acknowledged', 'Receiving colleague can acknowledge the handover');
select is((select acknowledged_by from public.request_handovers where id = current_setting('test.workflow_handover_a')::uuid), '62222222-2222-4222-8222-222222222222'::uuid, 'Handover acknowledgement records the actual recipient');
select is((select count(*)::integer from public.audit_events where entity_type = 'request_handover' and entity_id = current_setting('test.workflow_handover_a') and action = 'request_handover_acknowledged'), 1, 'Handover acknowledgement is audited');

-- Full appointment lifecycle: propose, patient accepts, hospital confirms, then completion.
set local role service_role;
select public.staff_handle_patient_request(
  '61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111',
  current_setting('test.workflow_request_a')::uuid, 'propose_appointment', 'Synthetic proposal A',
  now() + interval '3 days', now() + interval '3 days 1 hour', 'Synthetic location A', 'Synthetic instructions A'
);
reset role;
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 'appointment_proposed', 'Hospital proposal moves request into appointment-proposed state');
select is((select status::text from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 'proposed', 'Appointment is not confirmed merely because the hospital proposed it');
select is((select confirmed_at from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), null::timestamptz, 'Unaccepted proposal has no confirmation timestamp');

set local role service_role;
select throws_ok(
  $$select public.patient_respond_to_request('66666666-6666-4666-8666-666666666666', current_setting('test.workflow_request_a')::uuid, 'accept_appointment', 'I accept')$$,
  'P0001', 'Request not found',
  'Another patient cannot accept the appointment proposal'
);
select throws_ok(
  $$select public.staff_handle_patient_request('61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111', current_setting('test.workflow_request_a')::uuid, 'confirm_appointment', '', null::timestamptz, null::timestamptz, null, null)$$,
  'P0001', 'The patient must accept the proposed time before staff confirms the appointment',
  'Hospital cannot confirm an appointment before patient acceptance'
);
select public.patient_respond_to_request(
  '65555555-5555-4555-8555-555555555555',
  current_setting('test.workflow_request_a')::uuid,
  'accept_appointment',
  'Synthetic patient accepts the proposed time'
);
reset role;
select is((select status::text from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 'patient_accepted', 'Patient acceptance is distinct from hospital confirmation');

set local role service_role;
select public.staff_handle_patient_request(
  '61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111',
  current_setting('test.workflow_request_a')::uuid, 'confirm_appointment', 'Synthetic confirmation',
  null::timestamptz, null::timestamptz, null, null
);
reset role;
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 'confirmed', 'Hospital confirmation updates canonical request status');
select is((select status::text from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 'confirmed', 'Hospital confirmation updates appointment state');
select ok((select confirmed_at is not null and confirmed_by = '61111111-1111-4111-8111-111111111111'::uuid from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 'Confirmation records timestamp and authorised staff actor');
select is((select count(*)::integer from public.audit_events where entity_id = current_setting('test.workflow_request_a') and action = 'appointment_confirmed'), 1, 'Appointment confirmation is audit logged');

set local role service_role;
select public.staff_handle_patient_request(
  '61111111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111',
  current_setting('test.workflow_request_a')::uuid, 'complete_request', 'Synthetic workflow completion',
  null::timestamptz, null::timestamptz, null, null
);
reset role;
select is((select status::text from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 'completed', 'Completion closes the canonical request');
select is((select status::text from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 'completed', 'Completion moves the confirmed appointment to completed');
select is((select status::text from public.work_items where id = current_setting('test.workflow_work_a')::uuid), 'resolved', 'Completion resolves linked operational work');
select is((select count(*)::integer from public.audit_events where entity_id = current_setting('test.workflow_request_a') and action = 'patient_request_completed'), 1, 'Request completion is audit logged');

-- Patient RLS: only the patient's own request, profile, appointment and visible messages.
set local role authenticated;
select set_config('request.jwt.claim.sub', '65555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 1, 'Patient A can read their own request');
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_b')::uuid), 0, 'Patient A cannot read Patient B request');
select is((select count(*)::integer from public.appointments where patient_request_id = current_setting('test.workflow_request_a')::uuid), 1, 'Patient A can read their own appointment');
select is((select count(*)::integer from public.appointments where patient_request_id = current_setting('test.workflow_request_b')::uuid), 0, 'Patient A cannot read Patient B appointment');
select is((select count(*)::integer from public.patient_profiles where user_id = '65555555-5555-4555-8555-555555555555'), 1, 'Patient A can read their own profile');
select is((select count(*)::integer from public.patient_profiles where user_id = '66666666-6666-4666-8666-666666666666'), 0, 'Patient A cannot read Patient B profile');
select ok((select count(*) > 0 from public.request_messages where patient_request_id = current_setting('test.workflow_request_a')::uuid and visibility = 'patient_visible'), 'Patient A can read patient-visible messages on their own request');
select is((select count(*)::integer from public.request_messages where patient_request_id = current_setting('test.workflow_request_a')::uuid and visibility = 'internal'), 0, 'Patient A cannot read internal staff handover notes');
select is((select count(*)::integer from public.request_messages where patient_request_id = current_setting('test.workflow_request_b')::uuid), 0, 'Patient A cannot read Patient B messages');
select is((select count(*)::integer from public.request_handovers), 0, 'Patient account cannot read internal staff handover records');
reset role;

-- Hospital RLS: staff only sees its own tenant, including internal messages and handovers.
set local role authenticated;
select set_config('request.jwt.claim.sub', '61111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 1, 'Hospital A staff can read Hospital A request');
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_b')::uuid), 0, 'Hospital A staff cannot read Hospital B request');
select ok((select count(*) > 0 from public.request_messages where patient_request_id = current_setting('test.workflow_request_a')::uuid and visibility = 'internal'), 'Hospital A staff can read internal messages in Hospital A');
select is((select count(*)::integer from public.request_messages where patient_request_id = current_setting('test.workflow_request_b')::uuid), 0, 'Hospital A staff cannot read Hospital B messages');
select is((select count(*)::integer from public.request_handovers where id = current_setting('test.workflow_handover_a')::uuid), 1, 'Hospital A staff can read Hospital A handover');
select is((select count(*)::integer from public.request_handovers where id = current_setting('test.workflow_handover_b')::uuid), 0, 'Hospital A staff cannot read Hospital B handover');
select ok(not has_table_privilege('authenticated', 'public.user_notifications', 'select'), 'Notifications are not directly readable from browser clients');
reset role;

-- Reviewer is a member with read access, but the role is barred from mutations above.
set local role authenticated;
select set_config('request.jwt.claim.sub', '63333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_a')::uuid), 1, 'Reviewer may read records in the assigned hospital');
select is((select count(*)::integer from public.patient_requests where id = current_setting('test.workflow_request_b')::uuid), 0, 'Reviewer cannot read records from another hospital');
reset role;

select * from finish();
rollback;
