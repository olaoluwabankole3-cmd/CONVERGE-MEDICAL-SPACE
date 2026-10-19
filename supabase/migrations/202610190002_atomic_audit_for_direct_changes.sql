-- Make ordinary browser-side operational changes auditable in the same transaction.
-- Privileged server-side workflows keep their own actor-aware audit writes.
begin;

create or replace function public.audit_work_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  -- Service-role operations use explicit server-side audit writes. Do not falsely
  -- attribute those changes to the original creator when there is no JWT actor.
  if actor is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_events (
      hospital_id, actor_id, entity_type, entity_id, action, details
    ) values (
      new.hospital_id, actor, 'work_item', new.id::text, 'work_item_created',
      jsonb_build_object(
        'reference_code', new.reference_code,
        'item_type', new.item_type,
        'priority', new.priority,
        'status', new.status
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.audit_events (
        hospital_id, actor_id, entity_type, entity_id, action, details
      ) values (
        new.hospital_id, actor, 'work_item', new.id::text, 'work_item_status_changed',
        jsonb_build_object(
          'reference_code', new.reference_code,
          'previous_status', old.status,
          'status', new.status
        )
      );
    elsif row(new.reference_code, new.title, new.summary, new.item_type, new.priority,
              new.owner_id, new.external_reference, new.due_at, new.patient_record_id)
          is distinct from
          row(old.reference_code, old.title, old.summary, old.item_type, old.priority,
              old.owner_id, old.external_reference, old.due_at, old.patient_record_id) then
      insert into public.audit_events (
        hospital_id, actor_id, entity_type, entity_id, action, details
      ) values (
        new.hospital_id, actor, 'work_item', new.id::text, 'work_item_updated',
        jsonb_build_object(
          'reference_code', new.reference_code,
          'item_type', new.item_type,
          'priority', new.priority,
          'status', new.status
        )
      );
    end if;
    return new;
  else
    insert into public.audit_events (
      hospital_id, actor_id, entity_type, entity_id, action, details
    ) values (
      old.hospital_id, actor, 'work_item', old.id::text, 'work_item_deleted',
      jsonb_build_object('reference_code', old.reference_code, 'item_type', old.item_type)
    );
    return old;
  end if;
end;
$$;

drop trigger if exists work_items_audit_change on public.work_items;
create trigger work_items_audit_change
after insert or update or delete on public.work_items
for each row execute function public.audit_work_item_change();

create or replace function public.audit_patient_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  event_action text;
  event_hospital_id uuid;
  event_record_id uuid;
  event_reference_code text;
  event_care_area text;
  event_status public.patient_record_status;
begin
  actor := auth.uid();

  -- Privileged server-side workflows keep their own explicit audit events.
  if actor is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    event_hospital_id := old.hospital_id;
    event_record_id := old.id;
    event_reference_code := old.reference_code;
    event_care_area := old.care_area;
    event_status := old.status;
    event_action := 'patient_reference_deleted';
  elsif tg_op = 'INSERT' then
    event_hospital_id := new.hospital_id;
    event_record_id := new.id;
    event_reference_code := new.reference_code;
    event_care_area := new.care_area;
    event_status := new.status;
    event_action := 'patient_reference_created';
  else
    if new.status is not distinct from old.status
       and row(new.reference_code, new.external_reference, new.care_area)
           is not distinct from
           row(old.reference_code, old.external_reference, old.care_area) then
      return new;
    end if;
    event_hospital_id := new.hospital_id;
    event_record_id := new.id;
    event_reference_code := new.reference_code;
    event_care_area := new.care_area;
    event_status := new.status;
    if new.status is distinct from old.status and new.status = 'archived' then
      event_action := 'patient_reference_archived';
    elsif new.status is distinct from old.status and new.status = 'active' then
      event_action := 'patient_reference_reactivated';
    else
      event_action := 'patient_reference_updated';
    end if;
  end if;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    event_hospital_id, actor, 'patient_reference', event_record_id::text, event_action,
    jsonb_build_object('reference_code', event_reference_code, 'care_area', event_care_area, 'status', event_status)
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists patient_records_audit_change on public.patient_records;
create trigger patient_records_audit_change
after insert or update or delete on public.patient_records
for each row execute function public.audit_patient_record_change();

-- Audit rows are append-only from the browser. Only trusted server/database
-- code can create explicit events; browser CRUD is logged by the triggers above.
drop policy if exists "Members can append audit events" on public.audit_events;
revoke all privileges on table public.audit_events from public, anon, authenticated;
grant select on table public.audit_events to authenticated;

do $$
declare
  audit_sequence text;
begin
  audit_sequence := pg_get_serial_sequence('public.audit_events', 'id');
  if audit_sequence is not null then
    execute format(
      'revoke all privileges on sequence %s from public, anon, authenticated',
      audit_sequence
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
