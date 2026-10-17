-- Converge Medical Intelligence — human-approved operational follow-up tasks.
-- Apply after 202610180004_patient_request_transactional_workflows.sql.
--
-- A staff member can explicitly turn a reviewed analyst recommendation into a
-- normal operational task. The analyst itself never creates tasks. Creation and
-- the audit event are atomic inside this service-role-only RPC.

begin;

create or replace function public.create_operations_follow_up_task(
  p_actor_user_id uuid,
  p_hospital_id uuid,
  p_title text,
  p_summary text,
  p_priority public.work_item_priority,
  p_due_at timestamptz,
  p_source_recommendation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_authorised boolean := false;
  work_item_row public.work_items%rowtype;
  generated_reference text;
begin
  if p_actor_user_id is null or p_hospital_id is null then
    raise exception 'A signed-in staff actor and hospital are required';
  end if;

  if length(trim(coalesce(p_title, ''))) not between 3 and 240 then
    raise exception 'Task title must be between 3 and 240 characters';
  end if;

  if length(trim(coalesce(p_summary, ''))) not between 3 and 3000 then
    raise exception 'Task details must be between 3 and 3000 characters';
  end if;

  if length(trim(coalesce(p_source_recommendation, ''))) not between 3 and 160 then
    raise exception 'A valid source recommendation title is required';
  end if;

  if p_due_at is not null and p_due_at < now() then
    raise exception 'Choose a due date in the future or leave it blank';
  end if;

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

  generated_reference := 'AI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.work_items (
    hospital_id,
    reference_code,
    title,
    summary,
    item_type,
    priority,
    status,
    owner_id,
    external_reference,
    due_at,
    created_by
  ) values (
    p_hospital_id,
    generated_reference,
    trim(p_title),
    trim(p_summary),
    'task',
    coalesce(p_priority, 'medium'::public.work_item_priority),
    'open',
    null,
    null,
    p_due_at,
    p_actor_user_id
  )
  returning * into work_item_row;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    p_hospital_id,
    p_actor_user_id,
    'work_item',
    work_item_row.id::text,
    'operational_task_created_from_analyst',
    jsonb_build_object(
      'reference_code', work_item_row.reference_code,
      'item_type', 'task',
      'priority', work_item_row.priority,
      'due_at', work_item_row.due_at,
      'source', 'operations_analyst',
      'source_recommendation', trim(p_source_recommendation),
      'human_reviewed', true
    )
  );

  return jsonb_build_object(
    'id', work_item_row.id,
    'reference_code', work_item_row.reference_code,
    'title', work_item_row.title,
    'priority', work_item_row.priority,
    'due_at', work_item_row.due_at,
    'status', work_item_row.status
  );
end;
$$;

revoke all on function public.create_operations_follow_up_task(
  uuid, uuid, text, text, public.work_item_priority, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.create_operations_follow_up_task(
  uuid, uuid, text, text, public.work_item_priority, timestamptz, text
) to service_role;

notify pgrst, 'reload schema';

commit;
