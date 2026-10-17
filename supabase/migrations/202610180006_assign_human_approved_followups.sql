-- Converge Medical Intelligence — assignment for human-approved analyst tasks.
-- Apply after 202610180005_human_approved_operations_followups.sql.
--
-- Adds an assigned-task RPC without changing the previous function signature.
-- The underlying task and audit events plus ownership update all run in the
-- same database transaction; any validation/audit failure rolls the operation back.

begin;

create or replace function public.create_assigned_operations_follow_up_task(
  p_actor_user_id uuid,
  p_hospital_id uuid,
  p_title text,
  p_summary text,
  p_priority public.work_item_priority,
  p_due_at timestamptz,
  p_source_recommendation text,
  p_owner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_authorised boolean := false;
  target_is_authorised boolean := false;
  task_result jsonb;
  task_id uuid;
begin
  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = p_hospital_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin', 'clinician', 'operations')
      and h.status = 'active'
  ) into actor_is_authorised;

  if not coalesce(actor_is_authorised, false) then
    raise exception 'An active hospital owner, administrator, clinician, or operations member is required to create a task';
  end if;

  if p_owner_user_id is not null then
    select exists (
      select 1
      from public.hospital_memberships m
      join public.hospitals h on h.id = m.hospital_id
      where m.hospital_id = p_hospital_id
        and m.user_id = p_owner_user_id
        and m.role in ('owner', 'admin', 'clinician', 'operations')
        and h.status = 'active'
    ) into target_is_authorised;

    if not coalesce(target_is_authorised, false) then
      raise exception 'The assigned owner must be active operational staff in this hospital';
    end if;
  end if;

  task_result := public.create_operations_follow_up_task(
    p_actor_user_id,
    p_hospital_id,
    p_title,
    p_summary,
    p_priority,
    p_due_at,
    p_source_recommendation
  );

  task_id := (task_result ->> 'id')::uuid;

  if p_owner_user_id is not null then
    update public.work_items
      set owner_id = p_owner_user_id
      where id = task_id and hospital_id = p_hospital_id;

    if not found then
      raise exception 'The newly created task could not be assigned in this hospital';
    end if;

    insert into public.audit_events (
      hospital_id, actor_id, entity_type, entity_id, action, details
    ) values (
      p_hospital_id,
      p_actor_user_id,
      'work_item',
      task_id::text,
      'operational_task_assigned_from_analyst',
      jsonb_build_object(
        'owner_user_id', p_owner_user_id,
        'source', 'operations_analyst',
        'human_reviewed', true
      )
    );

    task_result := task_result || jsonb_build_object('owner_id', p_owner_user_id);
  else
    task_result := task_result || jsonb_build_object('owner_id', null);
  end if;

  return task_result;
end;
$$;

revoke all on function public.create_assigned_operations_follow_up_task(
  uuid, uuid, text, text, public.work_item_priority, timestamptz, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_assigned_operations_follow_up_task(
  uuid, uuid, text, text, public.work_item_priority, timestamptz, text, uuid
) to service_role;

notify pgrst, 'reload schema';

commit;
