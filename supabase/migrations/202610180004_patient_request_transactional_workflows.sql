-- Converge Medical Intelligence — transactional patient request workflows.
-- Apply after 202610180003_patient_request_core.sql.
--
-- This migration adds patient/staff messages and service-role-only RPCs so
-- request changes, appointment outcomes, internal work items, and audit events
-- are committed in one PostgreSQL transaction.
--
-- Application APIs must still authenticate the Supabase session and verify
-- patient ownership / hospital membership before invoking these functions.
-- The functions are deliberately not executable by anon or authenticated.

begin;

do $$ begin
  create type public.request_message_visibility as enum ('patient_visible', 'internal');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_message_author_type as enum ('patient', 'staff', 'system');
exception when duplicate_object then null;
end $$;

create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  patient_request_id uuid not null references public.patient_requests(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_type public.request_message_author_type not null,
  visibility public.request_message_visibility not null default 'patient_visible',
  body text not null check (length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);

create index if not exists request_messages_request_created_idx
  on public.request_messages(patient_request_id, created_at);

create or replace function public.enforce_request_message_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hospital uuid;
  request_patient uuid;
  staff_is_active boolean;
begin
  select r.hospital_id, r.patient_user_id
    into request_hospital, request_patient
    from public.patient_requests r
    where r.id = new.patient_request_id;

  if request_hospital is distinct from new.hospital_id then
    raise exception 'A message and its patient request must belong to the same hospital';
  end if;

  if new.author_type = 'patient' then
    if request_patient is distinct from new.author_user_id
       or new.visibility <> 'patient_visible' then
      raise exception 'A patient can only add patient-visible messages to their own request';
    end if;
  elsif new.author_type = 'staff' then
    select exists (
      select 1
      from public.hospital_memberships m
      join public.hospitals h on h.id = m.hospital_id
      where m.hospital_id = new.hospital_id
        and m.user_id = new.author_user_id
        and m.role in ('owner', 'admin', 'clinician', 'operations')
        and h.status = 'active'
    ) into staff_is_active;

    if not coalesce(staff_is_active, false) then
      raise exception 'A staff message requires active, authorised hospital membership';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists request_messages_scope on public.request_messages;
create trigger request_messages_scope
before insert or update on public.request_messages
for each row execute function public.enforce_request_message_scope();

alter table public.request_messages enable row level security;

revoke all privileges on table public.request_messages from public, anon, authenticated;
grant select on table public.request_messages to authenticated;
grant select, insert, update, delete on table public.request_messages to service_role;

drop policy if exists "Patients can read their own visible request messages" on public.request_messages;
create policy "Patients can read their own visible request messages"
on public.request_messages for select to authenticated
using (
  visibility = 'patient_visible'
  and exists (
    select 1 from public.patient_requests r
    where r.id = request_messages.patient_request_id
      and r.patient_user_id = (select auth.uid())
  )
);

drop policy if exists "Active hospital staff can read request messages" on public.request_messages;
create policy "Active hospital staff can read request messages"
on public.request_messages for select to authenticated
using (public.is_hospital_member(hospital_id));

-- Patient submission: profile, canonical request, work-queue item, initial
-- patient-visible message (if any), and audit event commit atomically.
create or replace function public.submit_patient_request(
  p_patient_user_id uuid,
  p_hospital_id uuid,
  p_service_id uuid,
  p_request_type public.patient_request_type,
  p_subject text,
  p_message text,
  p_preferred_start_at timestamptz,
  p_preferred_end_at timestamptz,
  p_display_name text,
  p_phone_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hospital_is_active boolean;
  service_is_available boolean;
  service_hospital uuid;
  request_row public.patient_requests%rowtype;
  work_type public.work_item_type;
begin
  if p_patient_user_id is null or p_hospital_id is null or p_service_id is null then
    raise exception 'Patient, hospital, and service are required';
  end if;
  if length(trim(coalesce(p_display_name, ''))) not between 2 and 160 then
    raise exception 'Enter a valid patient name';
  end if;
  if p_phone_number is not null and length(trim(p_phone_number)) not between 7 and 32 then
    raise exception 'Enter a valid phone number or leave it blank';
  end if;
  if length(trim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'The request subject must be between 3 and 160 characters';
  end if;
  if p_message is not null and length(p_message) > 3000 then
    raise exception 'The message is too long';
  end if;
  if p_request_type <> 'appointment'::public.patient_request_type
     and (p_preferred_start_at is not null or p_preferred_end_at is not null) then
    raise exception 'Preferred appointment times are only valid for appointment requests';
  end if;
  if p_preferred_end_at is not null
     and (p_preferred_start_at is null or p_preferred_end_at <= p_preferred_start_at) then
    raise exception 'Choose a valid preferred time range';
  end if;

  select h.status = 'active'
    into hospital_is_active
    from public.hospitals h
    where h.id = p_hospital_id;
  if coalesce(hospital_is_active, false) is not true then
    raise exception 'This hospital is not currently accepting requests';
  end if;

  select s.hospital_id, (s.is_active and s.is_published and h.status = 'active')
    into service_hospital, service_is_available
    from public.hospital_services s
    join public.hospitals h on h.id = s.hospital_id
    where s.id = p_service_id;
  if service_hospital is distinct from p_hospital_id
     or coalesce(service_is_available, false) is not true then
    raise exception 'This service is not available at the selected hospital';
  end if;

  insert into public.patient_profiles (user_id, display_name, phone_number)
  values (p_patient_user_id, trim(p_display_name), nullif(trim(coalesce(p_phone_number, '')), ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        phone_number = coalesce(excluded.phone_number, public.patient_profiles.phone_number),
        updated_at = now();

  insert into public.patient_requests (
    hospital_id, patient_user_id, service_id, request_type, status,
    subject, patient_message, preferred_start_at, preferred_end_at
  ) values (
    p_hospital_id, p_patient_user_id, p_service_id, p_request_type, 'submitted',
    trim(p_subject), null, p_preferred_start_at, p_preferred_end_at
  )
  returning * into request_row;

  work_type := case p_request_type
    when 'appointment' then 'appointment'::public.work_item_type
    when 'follow_up' then 'follow_up'::public.work_item_type
    else 'access_case'::public.work_item_type
  end;

  insert into public.work_items (
    hospital_id, reference_code, title, summary, item_type, priority,
    status, owner_id, external_reference, due_at, created_by, patient_request_id
  ) values (
    p_hospital_id, request_row.request_code, request_row.subject,
    'Submitted through the Converge patient portal',
    work_type, 'medium', 'open', null, null, null,
    p_patient_user_id, request_row.id
  );

  if nullif(trim(coalesce(p_message, '')), '') is not null then
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_patient_user_id, 'patient', 'patient_visible', trim(p_message)
    );
  end if;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    p_hospital_id, p_patient_user_id, 'patient_request', request_row.id::text,
    'patient_request_submitted',
    jsonb_build_object(
      'request_code', request_row.request_code,
      'request_type', request_row.request_type,
      'service_id', p_service_id
    )
  );

  return jsonb_build_object(
    'id', request_row.id,
    'request_code', request_row.request_code,
    'status', request_row.status,
    'hospital_id', request_row.hospital_id
  );
end;
$$;

-- Patient responses are limited to their own requests. Cancellation of an
-- already confirmed appointment is a request for cancellation, not an immediate
-- unilateral cancellation of the hospital's confirmed slot.
create or replace function public.patient_respond_to_request(
  p_patient_user_id uuid,
  p_patient_request_id uuid,
  p_action text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.patient_requests%rowtype;
  appointment_row public.appointments%rowtype;
  message_body text;
begin
  select * into request_row
    from public.patient_requests r
    where r.id = p_patient_request_id
      and r.patient_user_id = p_patient_user_id
    for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if p_action = 'accept_appointment' then
    select * into appointment_row
      from public.appointments a
      where a.patient_request_id = request_row.id
        and a.hospital_id = request_row.hospital_id
      for update;

    if not found or appointment_row.status <> 'proposed' then
      raise exception 'There is no open appointment proposal to accept';
    end if;
    if request_row.status not in ('appointment_proposed', 'awaiting_patient') then
      raise exception 'This request is not awaiting an appointment response';
    end if;

    update public.appointments
      set status = 'patient_accepted', updated_at = now()
      where id = appointment_row.id;

    message_body := coalesce(
      nullif(trim(coalesce(p_message, '')), ''),
      'I accept the proposed appointment time.'
    );
  elsif p_action = 'send_message' then
    if length(trim(coalesce(p_message, ''))) not between 1 and 3000 then
      raise exception 'Enter a message between 1 and 3000 characters';
    end if;
    if request_row.status in ('completed', 'no_show', 'cancelled', 'declined') then
      raise exception 'This request is closed and can no longer receive messages';
    end if;
    message_body := trim(p_message);

    if request_row.status = 'awaiting_patient' then
      update public.patient_requests
        set status = 'under_review', updated_at = now()
        where id = request_row.id;
    end if;
  elsif p_action = 'cancel_request' then
    if request_row.status in ('completed', 'no_show', 'cancelled', 'declined', 'cancellation_requested') then
      raise exception 'This request cannot be cancelled in its current state';
    end if;

    select * into appointment_row
      from public.appointments a
      where a.patient_request_id = request_row.id
        and a.hospital_id = request_row.hospital_id
      for update;

    if request_row.status in ('confirmed', 'in_progress') then
      update public.patient_requests
        set status = 'cancellation_requested', updated_at = now()
        where id = request_row.id;
      message_body := coalesce(
        nullif(trim(coalesce(p_message, '')), ''),
        'I would like to request cancellation. Please confirm the next step.'
      );
    else
      if found and appointment_row.status <> 'cancelled' then
        if appointment_row.status in ('completed', 'no_show') then
          raise exception 'A completed appointment cannot be cancelled';
        end if;
        update public.appointments
          set status = 'cancelled', updated_at = now()
          where id = appointment_row.id;
      end if;

      update public.patient_requests
        set status = 'cancelled', updated_at = now()
        where id = request_row.id;
      message_body := coalesce(
        nullif(trim(coalesce(p_message, '')), ''),
        'I would like to cancel this request.'
      );
      update public.work_items
        set status = 'closed', updated_at = now()
        where patient_request_id = request_row.id
          and hospital_id = request_row.hospital_id;
    end if;
  else
    raise exception 'Unsupported patient request action';
  end if;

  insert into public.request_messages (
    patient_request_id, hospital_id, author_user_id, author_type, visibility, body
  ) values (
    request_row.id, request_row.hospital_id, p_patient_user_id,
    'patient', 'patient_visible', message_body
  );

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    request_row.hospital_id, p_patient_user_id, 'patient_request', request_row.id::text,
    case p_action
      when 'accept_appointment' then 'appointment_proposal_accepted_by_patient'
      when 'cancel_request' then 'patient_cancellation_requested'
      else 'patient_request_message_sent'
    end,
    jsonb_build_object('request_code', request_row.request_code)
  );

  return jsonb_build_object('id', request_row.id, 'action', p_action);
end;
$$;

-- Hospital staff actions: review, ask the patient for information, propose and
-- confirm appointments, decline/complete requests, or resolve cancellation.
create or replace function public.staff_handle_patient_request(
  p_actor_user_id uuid,
  p_hospital_id uuid,
  p_patient_request_id uuid,
  p_action text,
  p_message text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_location text,
  p_instructions text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.patient_requests%rowtype;
  appointment_row public.appointments%rowtype;
  new_status public.patient_request_status;
  message_body text;
  action_event text;
  can_manage boolean;
begin
  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = p_hospital_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin', 'clinician', 'operations')
      and h.status = 'active'
  ) into can_manage;

  if not coalesce(can_manage, false) then
    raise exception 'Active hospital staff permission is required';
  end if;

  select * into request_row
    from public.patient_requests r
    where r.id = p_patient_request_id
      and r.hospital_id = p_hospital_id
    for update;

  if not found then
    raise exception 'Patient request not found in this hospital';
  end if;

  if p_action = 'start_review' then
    if request_row.status not in ('submitted', 'awaiting_hospital') then
      raise exception 'This request is not ready to enter review';
    end if;
    new_status := 'under_review';
    action_event := 'patient_request_review_started';
    update public.patient_requests set status = new_status, updated_at = now() where id = request_row.id;
    update public.work_items set status = 'in_progress', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;
  elsif p_action = 'ask_patient' then
    if length(trim(coalesce(p_message, ''))) not between 1 and 3000 then
      raise exception 'Enter a patient-visible message before requesting more information';
    end if;
    if request_row.status not in ('under_review', 'awaiting_hospital', 'appointment_proposed', 'awaiting_patient') then
      raise exception 'This request cannot be moved to awaiting patient in its current state';
    end if;
    if request_row.status <> 'awaiting_patient' then
      update public.patient_requests set status = 'awaiting_patient', updated_at = now() where id = request_row.id;
    end if;
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', trim(p_message)
    );
    update public.work_items set status = 'awaiting_response', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;
    action_event := 'patient_information_requested';
  elsif p_action = 'propose_appointment' then
    if request_row.request_type <> 'appointment' then
      raise exception 'Only appointment requests can receive appointment proposals';
    end if;
    if request_row.status not in ('under_review', 'awaiting_hospital', 'awaiting_patient') then
      raise exception 'Review this request before proposing an appointment';
    end if;
    if p_start_at is null or p_end_at is null or p_end_at <= p_start_at or p_start_at <= now() then
      raise exception 'Choose a valid future appointment start and end time';
    end if;
    if exists (
      select 1 from public.appointments a
      where a.patient_request_id = request_row.id
    ) then
      raise exception 'An appointment already exists for this request; rescheduling is not enabled in this pilot workflow';
    end if;

    insert into public.appointments (
      hospital_id, patient_request_id, status, start_at, end_at, location,
      patient_instructions, proposed_by
    ) values (
      p_hospital_id, request_row.id, 'proposed', p_start_at, p_end_at,
      nullif(trim(coalesce(p_location, '')), ''),
      nullif(trim(coalesce(p_instructions, '')), ''),
      p_actor_user_id
    ) returning * into appointment_row;

    update public.patient_requests set status = 'appointment_proposed', updated_at = now()
      where id = request_row.id;
    update public.work_items set status = 'awaiting_response', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;

    message_body := 'The hospital proposed an appointment for '
      || to_char(p_start_at, 'DD Mon YYYY HH24:MI TZ')
      || ' to ' || to_char(p_end_at, 'HH24:MI TZ') || '.';
    if nullif(trim(coalesce(p_location, '')), '') is not null then
      message_body := message_body || ' Location: ' || trim(p_location) || '.';
    end if;
    if nullif(trim(coalesce(p_instructions, '')), '') is not null then
      message_body := message_body || ' ' || trim(p_instructions);
    end if;
    if nullif(trim(coalesce(p_message, '')), '') is not null then
      message_body := message_body || ' ' || trim(p_message);
    end if;
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'appointment_proposed';
  elsif p_action = 'confirm_appointment' then
    if request_row.request_type <> 'appointment'
       or request_row.status not in ('appointment_proposed', 'awaiting_patient') then
      raise exception 'This request has no appointment awaiting hospital confirmation';
    end if;
    select * into appointment_row
      from public.appointments a
      where a.patient_request_id = request_row.id
        and a.hospital_id = p_hospital_id
      for update;
    if not found or appointment_row.status <> 'patient_accepted' then
      raise exception 'The patient must accept the proposed time before staff confirms the appointment';
    end if;

    update public.appointments
      set status = 'confirmed', confirmed_by = p_actor_user_id,
          confirmed_at = now(), updated_at = now()
      where id = appointment_row.id;

    update public.patient_requests set status = 'confirmed', updated_at = now()
      where id = request_row.id;
    update public.work_items set status = 'in_progress', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;

    message_body := 'Your appointment is confirmed for '
      || to_char(appointment_row.start_at, 'DD Mon YYYY HH24:MI TZ')
      || ' to ' || to_char(appointment_row.end_at, 'HH24:MI TZ') || '.';
    if appointment_row.location is not null then
      message_body := message_body || ' Location: ' || appointment_row.location || '.';
    end if;
    if appointment_row.patient_instructions is not null then
      message_body := message_body || ' ' || appointment_row.patient_instructions;
    end if;
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'appointment_confirmed';
  elsif p_action = 'decline_request' then
    if request_row.status not in ('submitted', 'under_review', 'awaiting_patient', 'awaiting_hospital', 'appointment_proposed') then
      raise exception 'This request cannot be declined in its current state';
    end if;
    select * into appointment_row from public.appointments a
      where a.patient_request_id = request_row.id and a.hospital_id = p_hospital_id
      for update;
    if found and appointment_row.status <> 'cancelled' then
      if appointment_row.status in ('completed', 'no_show') then
        raise exception 'A completed appointment cannot be declined';
      end if;
      update public.appointments set status = 'cancelled', updated_at = now()
        where id = appointment_row.id;
    end if;

    update public.patient_requests set status = 'declined', updated_at = now()
      where id = request_row.id;
    update public.work_items set status = 'closed', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;
    message_body := coalesce(
      nullif(trim(coalesce(p_message, '')), ''),
      'The hospital is unable to proceed with this request. Please contact the hospital if you need further assistance.'
    );
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'patient_request_declined';
  elsif p_action = 'complete_request' then
    if request_row.status not in ('under_review', 'confirmed', 'in_progress') then
      raise exception 'This request must be under review or in progress before completion';
    end if;
    if request_row.request_type = 'appointment' then
      select * into appointment_row from public.appointments a
        where a.patient_request_id = request_row.id and a.hospital_id = p_hospital_id
        for update;
      if not found or appointment_row.status <> 'confirmed' then
        raise exception 'Confirm the appointment before marking this request complete';
      end if;
      update public.appointments set status = 'completed', updated_at = now()
        where id = appointment_row.id;
    end if;
    update public.patient_requests set status = 'completed', updated_at = now()
      where id = request_row.id;
    update public.work_items set status = 'resolved', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;
    message_body := coalesce(
      nullif(trim(coalesce(p_message, '')), ''),
      'The hospital has marked your request as completed.'
    );
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'patient_request_completed';
  elsif p_action = 'approve_cancellation' then
    if request_row.status <> 'cancellation_requested' then
      raise exception 'There is no pending cancellation request to approve';
    end if;
    select * into appointment_row from public.appointments a
      where a.patient_request_id = request_row.id and a.hospital_id = p_hospital_id
      for update;
    if found and appointment_row.status <> 'cancelled' then
      if appointment_row.status in ('completed', 'no_show') then
        raise exception 'A completed appointment cannot be cancelled';
      end if;
      update public.appointments set status = 'cancelled', updated_at = now()
        where id = appointment_row.id;
    end if;
    update public.patient_requests set status = 'cancelled', updated_at = now()
      where id = request_row.id;
    update public.work_items set status = 'closed', updated_at = now()
      where patient_request_id = request_row.id and hospital_id = p_hospital_id;
    message_body := coalesce(
      nullif(trim(coalesce(p_message, '')), ''),
      'The hospital has approved your cancellation request.'
    );
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'patient_cancellation_approved';
  elsif p_action = 'reject_cancellation' then
    if request_row.status <> 'cancellation_requested' then
      raise exception 'There is no pending cancellation request to reject';
    end if;
    if request_row.request_type = 'appointment' then
      select * into appointment_row from public.appointments a
        where a.patient_request_id = request_row.id and a.hospital_id = p_hospital_id;
      if not found or appointment_row.status <> 'confirmed' then
        raise exception 'Only a still-confirmed appointment cancellation can be rejected';
      end if;
      new_status := 'confirmed';
    else
      new_status := 'in_progress';
    end if;
    update public.patient_requests set status = new_status, updated_at = now()
      where id = request_row.id;
    message_body := coalesce(
      nullif(trim(coalesce(p_message, '')), ''),
      'The hospital cannot approve the cancellation at this time. Please contact the hospital for assistance.'
    );
    insert into public.request_messages (
      patient_request_id, hospital_id, author_user_id, author_type, visibility, body
    ) values (
      request_row.id, p_hospital_id, p_actor_user_id, 'staff', 'patient_visible', message_body
    );
    action_event := 'patient_cancellation_rejected';
  else
    raise exception 'Unsupported hospital request action';
  end if;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    p_hospital_id, p_actor_user_id, 'patient_request', request_row.id::text,
    action_event,
    jsonb_build_object(
      'request_code', request_row.request_code,
      'request_type', request_row.request_type,
      'previous_status', request_row.status,
      'action', p_action
    )
  );

  return jsonb_build_object(
    'id', request_row.id,
    'request_code', request_row.request_code,
    'action', p_action
  );
end;
$$;

-- Only the server-side service role may execute these functions. The API must
-- authenticate the cookie session and pass the verified user ID after checks.
revoke all on function public.submit_patient_request(
  uuid, uuid, uuid, public.patient_request_type, text, text,
  timestamptz, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.submit_patient_request(
  uuid, uuid, uuid, public.patient_request_type, text, text,
  timestamptz, timestamptz, text, text
) to service_role;

revoke all on function public.patient_respond_to_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.patient_respond_to_request(uuid, uuid, text, text)
  to service_role;

revoke all on function public.staff_handle_patient_request(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.staff_handle_patient_request(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text
) to service_role;

notify pgrst, 'reload schema';

commit;
