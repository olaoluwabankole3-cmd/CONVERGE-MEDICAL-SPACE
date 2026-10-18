-- Converge Medical Intelligence — in-app notifications and assigned work.
-- Apply after 202610180006_assign_human_approved_followups.sql.
--
-- Notifications are read/written only through authenticated server routes. New
-- assignments create an in-app notification in the same database transaction.
-- Staff can manage the status of work items assigned to their own account; the
-- status update and its audit entry are committed together.

begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (
    notification_type in (
      'work_item_assigned',
      'work_item_reassigned',
      'work_item_status_changed',
      'system'
    )
  ),
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 500),
  action_url text not null default '/my-work' check (length(action_url) between 1 and 240),
  entity_type text not null default 'work_item' check (length(entity_type) between 1 and 80),
  entity_id text not null check (length(entity_id) between 1 and 120),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications(recipient_user_id, hospital_id, created_at desc);

create index if not exists user_notifications_unread_idx
  on public.user_notifications(recipient_user_id, hospital_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;

revoke all privileges on table public.user_notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.user_notifications to service_role;

create or replace function public.notify_work_item_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_is_active boolean := false;
  notification_kind text;
  notification_title text;
begin
  if new.owner_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = new.hospital_id
      and m.user_id = new.owner_id
      and h.status = 'active'
  ) into recipient_is_active;

  if not coalesce(recipient_is_active, false) then
    raise exception 'A work item can only notify an active member of its hospital';
  end if;

  if tg_op = 'UPDATE' and old.owner_id is not null then
    notification_kind := 'work_item_reassigned';
    notification_title := 'A task has been reassigned to you';
  else
    notification_kind := 'work_item_assigned';
    notification_title := 'A task has been assigned to you';
  end if;

  insert into public.user_notifications (
    hospital_id, recipient_user_id, notification_type, title, body,
    action_url, entity_type, entity_id
  ) values (
    new.hospital_id,
    new.owner_id,
    notification_kind,
    notification_title,
    'Work reference ' || new.reference_code || ' needs your attention.',
    '/my-work',
    'work_item',
    new.id::text
  );

  return new;
end;
$$;

drop trigger if exists work_items_notify_assignee on public.work_items;
drop trigger if exists work_items_notify_assignee_insert on public.work_items;
drop trigger if exists work_items_notify_assignee_update on public.work_items;

create trigger work_items_notify_assignee_insert
after insert on public.work_items
for each row execute function public.notify_work_item_assignee();

create trigger work_items_notify_assignee_update
after update of owner_id on public.work_items
for each row execute function public.notify_work_item_assignee();

create or replace function public.update_my_assigned_work_item_status(
  p_actor_user_id uuid,
  p_hospital_id uuid,
  p_work_item_id uuid,
  p_next_status public.work_item_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  work_item_row public.work_items%rowtype;
  actor_is_active boolean := false;
  previous_status public.work_item_status;
  creator_is_active boolean := false;
begin
  if p_actor_user_id is null or p_hospital_id is null or p_work_item_id is null then
    raise exception 'Actor, hospital, and work item are required';
  end if;

  if p_next_status not in (
    'open'::public.work_item_status,
    'needs_review'::public.work_item_status,
    'in_progress'::public.work_item_status,
    'awaiting_response'::public.work_item_status,
    'resolved'::public.work_item_status,
    'closed'::public.work_item_status
  ) then
    raise exception 'Choose a supported work status';
  end if;

  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = p_hospital_id
      and m.user_id = p_actor_user_id
      and h.status = 'active'
  ) into actor_is_active;

  if not coalesce(actor_is_active, false) then
    raise exception 'An active member of this hospital is required';
  end if;

  select *
    into work_item_row
    from public.work_items
    where id = p_work_item_id
      and hospital_id = p_hospital_id
      and owner_id = p_actor_user_id
    for update;

  if not found then
    raise exception 'This work item is not assigned to your account in this hospital';
  end if;

  previous_status := work_item_row.status;

  if previous_status in ('resolved'::public.work_item_status, 'closed'::public.work_item_status)
     and p_next_status is distinct from previous_status then
    raise exception 'Resolved or closed work items cannot be reopened from My Work';
  end if;

  if previous_status is distinct from p_next_status then
    update public.work_items
      set status = p_next_status
      where id = work_item_row.id
        and hospital_id = p_hospital_id
      returning * into work_item_row;

    insert into public.audit_events (
      hospital_id, actor_id, entity_type, entity_id, action, details
    ) values (
      p_hospital_id,
      p_actor_user_id,
      'work_item',
      work_item_row.id::text,
      'my_work_status_changed',
      jsonb_build_object(
        'reference_code', work_item_row.reference_code,
        'previous_status', previous_status,
        'status', p_next_status,
        'updated_from', 'my_work'
      )
    );

    if work_item_row.created_by is distinct from p_actor_user_id then
      select exists (
        select 1
        from public.hospital_memberships m
        join public.hospitals h on h.id = m.hospital_id
        where m.hospital_id = p_hospital_id
          and m.user_id = work_item_row.created_by
          and h.status = 'active'
      ) into creator_is_active;

      if coalesce(creator_is_active, false) then
        insert into public.user_notifications (
          hospital_id, recipient_user_id, notification_type, title, body,
          action_url, entity_type, entity_id
        ) values (
          p_hospital_id,
          work_item_row.created_by,
          'work_item_status_changed',
          'A task you created has been updated',
          'Work reference ' || work_item_row.reference_code || ' is now marked ' || replace(work_item_row.status::text, '_', ' ') || '.',
          '/my-work',
          'work_item',
          work_item_row.id::text
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id', work_item_row.id,
    'hospital_id', work_item_row.hospital_id,
    'reference_code', work_item_row.reference_code,
    'title', work_item_row.title,
    'status', work_item_row.status,
    'priority', work_item_row.priority,
    'due_at', work_item_row.due_at,
    'owner_id', work_item_row.owner_id,
    'updated_at', work_item_row.updated_at
  );
end;
$$;

revoke all on function public.update_my_assigned_work_item_status(
  uuid, uuid, uuid, public.work_item_status
) from public, anon, authenticated;

grant execute on function public.update_my_assigned_work_item_status(
  uuid, uuid, uuid, public.work_item_status
) to service_role;

notify pgrst, 'reload schema';

commit;
