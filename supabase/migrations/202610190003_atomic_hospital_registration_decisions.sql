-- Apply hospital approval/rejection and its audit event atomically.
-- This function is callable only by the trusted server-side service role;
-- the API route must first authenticate the platform administrator.
begin;

create or replace function public.decide_hospital_registration(
  p_hospital_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_hospital public.hospitals%rowtype;
  clean_reason text := nullif(trim(p_rejection_reason), '');
begin
  if p_hospital_id is null or p_actor_user_id is null then
    raise exception 'A hospital and authenticated platform administrator are required';
  end if;

  if p_decision not in ('active', 'rejected') then
    raise exception 'Unsupported hospital registration decision';
  end if;

  if p_decision = 'rejected' and (clean_reason is null or length(clean_reason) > 1000) then
    raise exception 'A rejection reason of 1 to 1000 characters is required';
  end if;

  select h.*
    into target_hospital
    from public.hospitals h
    where h.id = p_hospital_id
      and h.status = 'pending'
    for update;

  if not found then
    return null;
  end if;

  update public.hospitals
  set status = p_decision::public.hospital_status,
      approved_by = case when p_decision = 'active' then p_actor_user_id else null end,
      approved_at = case when p_decision = 'active' then now() else null end,
      rejection_reason = case when p_decision = 'rejected' then clean_reason else null end
  where id = p_hospital_id
    and status = 'pending'
  returning * into target_hospital;

  if not found then
    return null;
  end if;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    target_hospital.id,
    p_actor_user_id,
    'hospital',
    target_hospital.id::text,
    case when p_decision = 'active' then 'hospital_approved' else 'hospital_rejected' end,
    case
      when p_decision = 'active' then jsonb_build_object('hospital_name', target_hospital.name)
      else jsonb_build_object('hospital_name', target_hospital.name, 'rejection_reason', clean_reason)
    end
  );

  -- If the audit insert fails, PostgreSQL rolls back the hospital status change too.
  return jsonb_build_object(
    'id', target_hospital.id,
    'name', target_hospital.name,
    'status', target_hospital.status
  );
end;
$$;

revoke all on function public.decide_hospital_registration(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.decide_hospital_registration(uuid, uuid, text, text)
to service_role;

notify pgrst, 'reload schema';
commit;
