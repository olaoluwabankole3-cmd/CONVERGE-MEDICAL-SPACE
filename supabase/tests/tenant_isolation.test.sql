begin;

select plan(33);

-- Deterministic synthetic users/hospitals. Entire test rolls back.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'tenant-a-security-test@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'tenant-b-security-test@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.hospitals (id, name, contact_email, status, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Hospital A', 'ops-a@example.invalid', 'active',
   '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Hospital B', 'ops-b@example.invalid', 'active',
   '22222222-2222-4222-8222-222222222222'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Synthetic Pending Hospital', 'ops-pending@example.invalid', 'pending',
   '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.hospital_memberships (hospital_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner')
on conflict (hospital_id, user_id) do nothing;

insert into public.work_items
  (hospital_id, reference_code, title, item_type, priority, status, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A-WORK-001', 'Synthetic tenant A work item', 'task', 'low', 'open',
   '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SEC-B-WORK-001', 'Synthetic tenant B work item', 'task', 'low', 'open',
   '22222222-2222-4222-8222-222222222222')
on conflict (hospital_id, reference_code) do nothing;

insert into public.patient_records
  (hospital_id, reference_code, care_area, status, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A-PAT-001', 'Synthetic', 'active',
   '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SEC-B-PAT-001', 'Synthetic', 'active',
   '22222222-2222-4222-8222-222222222222')
on conflict (hospital_id, reference_code) do nothing;

insert into public.audit_events
  (hospital_id, actor_id, entity_type, entity_id, action, details)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'test', 'SEC-A', 'seed', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'test', 'SEC-B', 'seed', '{}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.hospitals where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'Hospital A member can see Hospital A'
);
select is(
  (select count(*)::integer from public.hospitals where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'Hospital A member cannot see Hospital B'
);
select is(
  (select count(*)::integer from public.hospital_memberships where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'Hospital A member can see memberships inside Hospital A'
);
select is(
  (select count(*)::integer from public.hospital_memberships where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'Hospital A member cannot see Hospital B memberships'
);
select is(
  (select count(*)::integer from public.work_items where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'Hospital A member can see Hospital A work'
);
select is(
  (select count(*)::integer from public.work_items where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'Hospital A member cannot read Hospital B work'
);
select is(
  (select count(*)::integer from public.patient_records where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'Hospital A member can see Hospital A patient references'
);
select is(
  (select count(*)::integer from public.patient_records where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'Hospital A member cannot read Hospital B patient references'
);
select is(
  (select count(*)::integer from public.audit_events where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'Hospital A member can read Hospital A audit history'
);
select is(
  (select count(*)::integer from public.audit_events where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'Hospital A member cannot read Hospital B audit history'
);

-- A logged-in browser mutation and its audit event must commit atomically.
insert into public.work_items
  (id, hospital_id, reference_code, title, item_type, priority, status, created_by)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'SEC-A-WORK-002', 'Synthetic audit trigger test', 'task', 'low', 'open',
   '11111111-1111-4111-8111-111111111111');

select is(
  (select count(*)::integer from public.audit_events
    where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and actor_id = auth.uid()
      and entity_type = 'work_item'
      and entity_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and action = 'work_item_created'),
  1,
  'Work item creation writes its audit event in the same transaction'
);

update public.work_items
  set status = 'needs_review'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*)::integer from public.audit_events
    where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and actor_id = auth.uid()
      and entity_type = 'work_item'
      and entity_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and action = 'work_item_status_changed'),
  1,
  'Work item status change is audit logged atomically'
);

insert into public.patient_records
  (id, hospital_id, reference_code, care_area, status, created_by)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'SEC-A-PAT-002', 'Synthetic', 'active',
   '11111111-1111-4111-8111-111111111111');

select is(
  (select count(*)::integer from public.audit_events
    where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and actor_id = auth.uid()
      and entity_type = 'patient_reference'
      and entity_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and action = 'patient_reference_created'),
  1,
  'Patient reference creation writes its audit event in the same transaction'
);

update public.patient_records
  set status = 'archived'
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    and hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*)::integer from public.audit_events
    where hospital_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and actor_id = auth.uid()
      and entity_type = 'patient_reference'
      and entity_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and action = 'patient_reference_archived'),
  1,
  'Patient reference status change is audit logged atomically'
);

select lives_ok(
  $$update public.work_items set title = 'Cross-tenant mutation attempt' where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  'Cross-tenant update statement does not raise an error'
);
reset role;
select is(
  (select count(*)::integer from public.work_items where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and title = 'Cross-tenant mutation attempt'),
  0,
  'Cross-tenant update did not alter Hospital B data'
);
set local role authenticated;
select throws_ok(
  $$insert into public.work_items
    (hospital_id, reference_code, title, item_type, priority, status, created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SEC-CROSS-TENANT-INSERT',
      'Attempted cross-tenant insert', 'task', 'low', 'open',
      '11111111-1111-4111-8111-111111111111')$$,
  '42501',
  null,
  'Cross-tenant work-item insert is rejected by RLS'
);
select throws_ok(
  $$insert into public.audit_events
    (hospital_id, actor_id, entity_type, entity_id, action, details)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222', 'test', 'SEC-FORGE', 'forged_actor', '{}'::jsonb)$$,
  '42501',
  null,
  'Browser cannot directly insert audit events'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_notifications', 'select'),
  'Authenticated users have no direct table access to notifications'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'insert'),
  'Authenticated users cannot directly insert audit events'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'update'),
  'Authenticated users cannot update audit history directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'delete'),
  'Authenticated users cannot delete audit history directly'
);
select ok(
  not has_table_privilege('anon', 'public.patient_requests', 'select'),
  'Anonymous role cannot directly read patient requests'
);
select ok(
  not has_table_privilege('anon', 'public.user_notifications', 'select'),
  'Anonymous role cannot directly read notifications'
);

select ok(
  not has_function_privilege('anon', 'public.is_hospital_member(uuid)', 'execute'),
  'Anonymous role cannot execute the SECURITY DEFINER membership helper'
);
select ok(
  has_function_privilege('authenticated', 'public.is_hospital_member(uuid)', 'execute'),
  'Authenticated role can execute membership helper needed by RLS'
);
select ok(
  not has_function_privilege('anon', 'public.has_hospital_role(uuid,public.hospital_member_role[])', 'execute'),
  'Anonymous role cannot execute the SECURITY DEFINER role helper'
);
select ok(
  has_function_privilege('authenticated', 'public.has_hospital_role(uuid,public.hospital_member_role[])', 'execute'),
  'Authenticated role can execute role helper needed by RLS'
);
select ok(
  not has_function_privilege('authenticated', 'public.decide_hospital_registration(uuid,uuid,text,text)', 'execute'),
  'Authenticated users cannot directly invoke platform hospital approval'
);
select ok(
  not has_function_privilege('anon', 'public.decide_hospital_registration(uuid,uuid,text,text)', 'execute'),
  'Anonymous users cannot invoke platform hospital approval'
);
select ok(
  has_function_privilege('service_role', 'public.decide_hospital_registration(uuid,uuid,text,text)', 'execute'),
  'Only the trusted server role can invoke platform hospital approval'
);

reset role;
set local role service_role;
select public.decide_hospital_registration(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  'active',
  null
);
reset role;
select is(
  (select status::text from public.hospitals where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'active',
  'Hospital registration is approved by the atomic decision function'
);
select is(
  (select count(*)::integer from public.audit_events
    where hospital_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and actor_id = '11111111-1111-4111-8111-111111111111'
      and action = 'hospital_approved'),
  1,
  'Hospital approval creates its audit event in the same transaction'
);

reset role;
select * from finish();
rollback;
