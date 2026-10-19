begin;

select plan(18);

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
   '22222222-2222-4222-8222-222222222222')
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
select is(
  (with changed as (
    update public.work_items set title = 'Cross-tenant mutation attempt'
    where hospital_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    returning id
  ) select count(*)::integer from changed),
  0,
  'Cross-tenant work-item update changes zero rows'
);
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
  'Audit event cannot be attributed to a different actor'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_notifications', 'select'),
  'Authenticated users have no direct table access to notifications'
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

reset role;
select * from finish();
rollback;
