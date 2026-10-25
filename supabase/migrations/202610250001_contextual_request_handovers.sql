-- Contextual staff handovers for Converge Coordination Room.
-- Apply after 202610180007_notifications_and_assigned_work.sql.
-- Every handover, internal note, assignment notification, and audit event is
-- written inside the same PostgreSQL transaction.

begin;

create table if not exists public.request_handovers (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  patient_request_id uuid not null references public.patient_requests(id) on delete cascade,
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  note text not null check (length(trim(note)) between 5 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'cancelled')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete restrict,
  check (
    (status = 'acknowledged' and acknowledged_at is not null and acknowledged_by = to_user_id)
    or (status in ('pending', 'cancelled') and acknowledged_at is null and acknowledged_by is null)
  ),
  check (from_user_id <> to_user_id)
);

create index if not exists request_handovers_request_created_idx
  on public.request_handovers(patient_request_id, created_at desc);
create index if not exists request_handovers_recipient_status_idx
  on public.request_handovers(hospital_id, to_user_id, status, created_at desc);
create unique index if not exists request_handovers_one_pending_per_work_item
  on public.request_handovers(work_item_id) where status = 'pending';

alter table public.request_handovers enable row level security;
revoke all privileges on table public.request_handovers from public, anon, authenticated;
grant select on table public.request_handovers to authenticated;
grant select, insert, update, delete on table public.request_handovers to service_role;

drop policy if exists "Active hospital staff can read request handovers" on public.request_handovers;
create policy "Active hospital staff can read request handovers"
on public.request_handovers for select to authenticated
using (public.is_hospital_member(hospital_id));

create or replace function public.record_patient_request_handover(
  p_actor_user_id uuid,
  p_hospital_id uuid,
  p_patient_request_id uuid,
  p_work_item_id uuid,
  p_recipient_user_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.patient_requests%rowtype;
  work_item_row public.work_items%rowtype;
  handover_row public.request_handovers%rowtype;
  previous_handover public.request_handovers%rowtype;
  actor_can_manage boolean := false;
  recipient_is_member boolean := false;
  request_is_active boolean := false;
begin
  if p_actor_user_id is null or p_hospital_id is null or p_patient_request_id is null
     or p_work_item_id is null or p_recipient_user_id is null then
    raise exception 'Hospital, request, work item, sender and recipient are required';
  end if;
  if p_actor_user_id = p_recipient_user_id then
    raise exception 'Choose another staff member to receive the handover';
  end if;
  if length(trim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'Add a handover note between 5 and 2000 characters';
  end if;

  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = p_hospital_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin', 'clinician', 'operations')
      and h.status = 'active'
  ) into actor_can_manage;
  if not coalesce(actor_can_manage, false) then
    raise exception 'Active hospital staff permission is required to hand over work';
  end if;

  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = p_hospital_id
      and m.user_id = p_recipient_user_id
      and m.role in ('owner', 'admin', 'clinician', 'operations', 'reviewer')
      and h.status = 'active'
  ) into recipient_is_member;
  if not coalesce(recipient_is_member, false) then
    raise exception 'The receiving staff member must have active membership in this hospital';
  end if;

  select * into request_row
  from public.patient_requests r
  where r.id = p_patient_request_id and r.hospital_id = p_hospital_id
  for update;
  if not found then
    raise exception 'Patient request was not found in this hospital';
  end if;
  if request_row.status::text in ('completed', 'no_show', 'cancelled', 'declined') then
    raise exception 'A closed request cannot be handed over';
  end if;

  select * into work_item_row
  from public.work_items w
  where w.id = p_work_item_id
    and w.hospital_id = p_hospital_id
    and w.patient_request_id = p_patient_request_id
  for update;
  if not found then
    raise exception 'Choose a work item linked to this request and hospital';
  end if;
  if work_item_row.status::text in ('resolved', 'closed', 'draft') then
    raise exception 'Only active operational work can be handed over';
  end if;
  if work_item_row.owner_id is not distinct from p_recipient_user_id then
    raise exception 'This work item is already assigned to the selected colleague';
  end if;

  -- A new transfer replaces any unacknowledged transfer for this work item.
  for previous_handover in
    select * from public.request_handovers
    where work_item_id = p_work_item_id and status = 'pending'
    for update
  loop
    update public.request_handovers set status = 'cancelled'
    where id = previous_handover.id;

    insert into public.audit_events (
      hospital_id, actor_id, entity_type, entity_id, action, details
    ) values (
      p_hospital_id, p_actor_user_id, 'request_handover', previous_handover.id::text,
      'request_handover_superseded',
      jsonb_build_object('patient_request_id', p_patient_request_id, 'work_item_id', p_work_item_id)
    );
  end loop;

  insert into public.request_handovers (
    hospital_id, patient_request_id, work_item_id, from_user_id, to_user_id, note
  ) values (
    p_hospital_id, p_patient_request_id, p_work_item_id,
    p_actor_user_id, p_recipient_user_id, trim(p_note)
  ) returning * into handover_row;

  insert into public.request_messages (
    patient_request_id, hospital_id, author_user_id, author_type, visibility, body
  ) values (
    p_patient_request_id, p_hospital_id, p_actor_user_id, 'staff', 'internal',
    'Handover to staff member ' || p_recipient_user_id::text || ' for work item '
      || work_item_row.reference_code || E'\n' || trim(p_note)
  );

  -- This existing trigger creates an in-app assignment notification in this
  -- same transaction. If the notification cannot be created, the handover rolls back.
  update public.work_items
  set owner_id = p_recipient_user_id, updated_at = now()
  where id = p_work_item_id and hospital_id = p_hospital_id;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values
    (
      p_hospital_id, p_actor_user_id, 'patient_request', p_patient_request_id::text,
      'patient_request_handed_over',
      jsonb_build_object(
        'handover_id', handover_row.id,
        'work_item_id', p_work_item_id,
        'from_user_id', p_actor_user_id,
        'to_user_id', p_recipient_user_id,
        'work_reference', work_item_row.reference_code
      )
    ),
    (
      p_hospital_id, p_actor_user_id, 'work_item', p_work_item_id::text,
      'work_item_handed_over',
      jsonb_build_object(
        'handover_id', handover_row.id,
        'from_user_id', p_actor_user_id,
        'to_user_id', p_recipient_user_id,
        'reference_code', work_item_row.reference_code
      )
    ),
    (
      p_hospital_id, p_actor_user_id, 'request_handover', handover_row.id::text,
      'request_handover_created',
      jsonb_build_object(
        'patient_request_id', p_patient_request_id,
        'work_item_id', p_work_item_id,
        'from_user_id', p_actor_user_id,
        'to_user_id', p_recipient_user_id
      )
    );

  return jsonb_build_object(
    'id', handover_row.id,
    'patient_request_id', handover_row.patient_request_id,
    'work_item_id', handover_row.work_item_id,
    'from_user_id', handover_row.from_user_id,
    'to_user_id', handover_row.to_user_id,
    'note', handover_row.note,
    'status', handover_row.status,
    'created_at', handover_row.created_at
  );
end;
$$;

revoke all on function public.record_patient_request_handover(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_patient_request_handover(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;

create or replace function public.acknowledge_patient_request_handover(
  p_actor_user_id uuid,
  p_handover_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  handover_row public.request_handovers%rowtype;
  work_item_row public.work_items%rowtype;
  actor_is_recipient boolean := false;
begin
  if p_actor_user_id is null or p_handover_id is null then
    raise exception 'The recipient and handover are required';
  end if;

  select * into handover_row
  from public.request_handovers h
  where h.id = p_handover_id
  for update;
  if not found then
    raise exception 'Handover not found';
  end if;
  if handover_row.status <> 'pending' then
    raise exception 'This handover is no longer awaiting acknowledgement';
  end if;
  if handover_row.to_user_id <> p_actor_user_id then
    raise exception 'Only the assigned recipient can acknowledge this handover';
  end if;

  select exists (
    select 1 from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = handover_row.hospital_id
      and m.user_id = p_actor_user_id
      and h.status = 'active'
  ) into actor_is_recipient;
  if not coalesce(actor_is_recipient, false) then
    raise exception 'Active membership in this hospital is required';
  end if;

  update public.request_handovers
  set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = p_actor_user_id
  where id = handover_row.id
  returning * into handover_row;

  select * into work_item_row from public.work_items
  where id = handover_row.work_item_id and hospital_id = handover_row.hospital_id;

  insert into public.request_messages (
    patient_request_id, hospital_id, author_user_id, author_type, visibility, body
  ) values (
    handover_row.patient_request_id, handover_row.hospital_id, p_actor_user_id, 'staff', 'internal',
    'Handover received and acknowledged for work item '
      || coalesce(work_item_row.reference_code, handover_row.work_item_id::text) || '.'
  );

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values
    (
      handover_row.hospital_id, p_actor_user_id, 'patient_request',
      handover_row.patient_request_id::text, 'patient_request_handover_acknowledged',
      jsonb_build_object('handover_id', handover_row.id, 'work_item_id', handover_row.work_item_id)
    ),
    (
      handover_row.hospital_id, p_actor_user_id, 'request_handover',
      handover_row.id::text, 'request_handover_acknowledged',
      jsonb_build_object('patient_request_id', handover_row.patient_request_id, 'work_item_id', handover_row.work_item_id)
    );

  return jsonb_build_object(
    'id', handover_row.id,
    'patient_request_id', handover_row.patient_request_id,
    'work_item_id', handover_row.work_item_id,
    'status', handover_row.status,
    'acknowledged_at', handover_row.acknowledged_at,
    'acknowledged_by', handover_row.acknowledged_by
  );
end;
$$;

revoke all on function public.acknowledge_patient_request_handover(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_patient_request_handover(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
