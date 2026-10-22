-- Save hospital settings and their audit event as one indivisible operation.
-- The server API authenticates the caller before using service_role; this function
-- also checks that the supplied actor is an active owner/admin of the target hospital.
begin;

create or replace function public.update_hospital_settings_with_audit(
  p_hospital_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_country text,
  p_city text,
  p_contact_email text,
  p_registration_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_hospital public.hospitals%rowtype;
  authorised_actor boolean;
  clean_name text := trim(coalesce(p_name, ''));
  clean_country text := trim(coalesce(p_country, ''));
  clean_city text := nullif(trim(coalesce(p_city, '')), '');
  clean_email text := lower(trim(coalesce(p_contact_email, '')));
  clean_registration text := nullif(trim(coalesce(p_registration_number, '')), '');
begin
  if p_hospital_id is null or p_actor_user_id is null then
    raise exception 'A hospital and authenticated actor are required';
  end if;

  if length(clean_name) not between 2 and 180
     or length(clean_country) not between 1 and 100
     or (clean_city is not null and length(clean_city) > 120)
     or clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(clean_email) > 254
     or (clean_registration is not null and length(clean_registration) > 120) then
    raise exception 'Hospital settings contain invalid values';
  end if;

  select h.*
    into target_hospital
    from public.hospitals h
    where h.id = p_hospital_id
    for update;

  if not found or target_hospital.status <> 'active' then
    raise exception 'Hospital settings can only be changed for an active hospital'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.hospital_memberships m
    where m.hospital_id = p_hospital_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin')
  )
  into authorised_actor;

  if not coalesce(authorised_actor, false) then
    raise exception 'Active hospital owner or administrator required'
      using errcode = '42501';
  end if;

  update public.hospitals
    set name = clean_name,
        country = clean_country,
        city = clean_city,
        contact_email = clean_email,
        registration_number = clean_registration
    where id = p_hospital_id
    returning * into target_hospital;

  insert into public.audit_events (
    hospital_id, actor_id, entity_type, entity_id, action, details
  ) values (
    p_hospital_id,
    p_actor_user_id,
    'hospital',
    p_hospital_id::text,
    'hospital_settings_updated',
    jsonb_build_object(
      'name', target_hospital.name,
      'country', target_hospital.country,
      'city', target_hospital.city,
      'contact_email', target_hospital.contact_email,
      'registration_number', target_hospital.registration_number
    )
  );

  -- Any error inserting the audit event aborts this entire function statement,
  -- so a settings change cannot commit without its audit record.
  return jsonb_build_object(
    'id', target_hospital.id,
    'name', target_hospital.name,
    'registration_number', target_hospital.registration_number,
    'country', target_hospital.country,
    'city', target_hospital.city,
    'contact_email', target_hospital.contact_email,
    'status', target_hospital.status,
    'created_at', target_hospital.created_at,
    'updated_at', target_hospital.updated_at
  );
end;
$$;

revoke all on function public.update_hospital_settings_with_audit(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_hospital_settings_with_audit(
  uuid, uuid, text, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
commit;
