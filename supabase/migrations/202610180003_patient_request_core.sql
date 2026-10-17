-- Converge Medical Intelligence — canonical patient request core.
-- Apply only after 202610180002_restrict_client_table_privileges.sql.
--
-- Adds the minimal domain layer needed to connect the patient portal to
-- hospital operations. Existing hospitals, memberships, patient references,
-- work items, and audit events remain in place.
--
-- Patient/staff writes to this new domain are deliberately API-mediated.
-- Authenticated clients receive read access protected by RLS, but no direct
-- INSERT/UPDATE/DELETE grants on these tables. Server-side routes must verify
-- the session, patient ownership or hospital role, validate the requested
-- state transition, and write the operational change and audit event safely.

begin;

do $$ begin
  create type public.patient_request_type as enum ('appointment', 'service_request', 'follow_up');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.patient_request_status as enum (
    'submitted',
    'under_review',
    'awaiting_patient',
    'awaiting_hospital',
    'appointment_proposed',
    'confirmed',
    'in_progress',
    'cancellation_requested',
    'completed',
    'cancelled',
    'declined'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.appointment_status as enum (
    'proposed',
    'patient_accepted',
    'reschedule_requested',
    'confirmed',
    'cancelled',
    'completed',
    'no_show'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.patient_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 2 and 160),
  phone_number text check (phone_number is null or length(trim(phone_number)) between 7 and 32),
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hospital_services (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  service_code text not null check (length(trim(service_code)) between 2 and 80),
  name text not null check (length(trim(name)) between 2 and 160),
  description text check (description is null or length(description) <= 1200),
  department text check (department is null or length(department) <= 120),
  is_published boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 100000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, service_code)
);

create table if not exists public.patient_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique default (
    'REQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  patient_user_id uuid not null references auth.users(id) on delete restrict,
  patient_record_id uuid references public.patient_records(id) on delete set null,
  service_id uuid references public.hospital_services(id) on delete set null,
  request_type public.patient_request_type not null,
  status public.patient_request_status not null default 'submitted',
  subject text not null check (length(trim(subject)) between 3 and 160),
  patient_message text check (patient_message is null or length(patient_message) <= 2000),
  preferred_start_at timestamptz,
  preferred_end_at timestamptz,
  submitted_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    preferred_end_at is null
    or (preferred_start_at is not null and preferred_end_at > preferred_start_at)
  ),
  check (
    request_type = 'appointment'
    or (preferred_start_at is null and preferred_end_at is null)
  )
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  patient_request_id uuid not null unique references public.patient_requests(id) on delete restrict,
  status public.appointment_status not null default 'proposed',
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text check (location is null or length(location) <= 240),
  patient_instructions text check (patient_instructions is null or length(patient_instructions) <= 1200),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (
    status <> 'confirmed'
    or confirmed_at is not null
  )
);

alter table public.work_items
  add column if not exists patient_request_id uuid
  references public.patient_requests(id) on delete set null;

create index if not exists hospital_services_public_lookup_idx
  on public.hospital_services(hospital_id, is_published, is_active, display_order);

create index if not exists patient_requests_hospital_status_idx
  on public.patient_requests(hospital_id, status, created_at desc);

create index if not exists patient_requests_patient_created_idx
  on public.patient_requests(patient_user_id, created_at desc);

create index if not exists patient_requests_hospital_service_idx
  on public.patient_requests(hospital_id, service_id)
  where service_id is not null;

create index if not exists appointments_hospital_start_idx
  on public.appointments(hospital_id, start_at, status);

create index if not exists work_items_hospital_patient_request_idx
  on public.work_items(hospital_id, patient_request_id)
  where patient_request_id is not null;

drop trigger if exists patient_profiles_set_updated_at on public.patient_profiles;
create trigger patient_profiles_set_updated_at
before update on public.patient_profiles
for each row execute function public.set_updated_at();

drop trigger if exists hospital_services_set_updated_at on public.hospital_services;
create trigger hospital_services_set_updated_at
before update on public.hospital_services
for each row execute function public.set_updated_at();

drop trigger if exists patient_requests_set_updated_at on public.patient_requests;
create trigger patient_requests_set_updated_at
before update on public.patient_requests
for each row execute function public.set_updated_at();

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

create or replace function public.prevent_patient_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'A patient profile cannot be moved to another account';
  end if;
  return new;
end;
$$;

drop trigger if exists patient_profiles_prevent_identity_change on public.patient_profiles;
create trigger patient_profiles_prevent_identity_change
before update on public.patient_profiles
for each row execute function public.prevent_patient_profile_identity_change();

create or replace function public.prevent_hospital_service_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hospital_id is distinct from old.hospital_id
     or new.created_by is distinct from old.created_by then
    raise exception 'A hospital service cannot be moved between hospitals or creators';
  end if;
  return new;
end;
$$;

drop trigger if exists hospital_services_prevent_scope_change on public.hospital_services;
create trigger hospital_services_prevent_scope_change
before update on public.hospital_services
for each row execute function public.prevent_hospital_service_scope_change();

create or replace function public.enforce_patient_request_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hospital_is_active boolean;
  service_hospital uuid;
  service_is_public boolean;
  record_hospital uuid;
  record_is_active boolean;
  transition_allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' then
      raise exception 'A new patient request must start in submitted status';
    end if;

    select h.status = 'active'
      into hospital_is_active
      from public.hospitals h
      where h.id = new.hospital_id;

    if coalesce(hospital_is_active, false) is not true then
      raise exception 'Patient requests can only be submitted to an active hospital';
    end if;

    if new.service_id is not null then
      select s.hospital_id, (s.is_active and s.is_published and h.status = 'active')
        into service_hospital, service_is_public
        from public.hospital_services s
        join public.hospitals h on h.id = s.hospital_id
        where s.id = new.service_id;

      if service_hospital is distinct from new.hospital_id
         or coalesce(service_is_public, false) is not true then
        raise exception 'The selected service is not available at this hospital';
      end if;
    end if;

    if new.patient_record_id is not null then
      select p.hospital_id, (p.status = 'active')
        into record_hospital, record_is_active
        from public.patient_records p
        where p.id = new.patient_record_id;

      if record_hospital is distinct from new.hospital_id
         or coalesce(record_is_active, false) is not true then
        raise exception 'The patient reference must be active and belong to this hospital';
      end if;
    end if;

    return new;
  end if;

  if new.hospital_id is distinct from old.hospital_id
     or new.patient_user_id is distinct from old.patient_user_id
     or new.request_code is distinct from old.request_code
     or new.submitted_at is distinct from old.submitted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Patient request identity and tenant scope cannot be changed';
  end if;

  if new.status is distinct from old.status then
    transition_allowed :=
      case old.status
        when 'submitted' then new.status in ('under_review', 'cancelled', 'declined')
        when 'under_review' then new.status in (
          'awaiting_patient', 'awaiting_hospital', 'appointment_proposed',
          'confirmed', 'in_progress', 'completed', 'cancelled', 'declined'
        )
        when 'awaiting_patient' then new.status in (
          'under_review', 'awaiting_hospital', 'appointment_proposed',
          'confirmed', 'cancellation_requested', 'cancelled', 'declined'
        )
        when 'awaiting_hospital' then new.status in (
          'under_review', 'awaiting_patient', 'appointment_proposed',
          'confirmed', 'cancellation_requested', 'cancelled', 'declined'
        )
        when 'appointment_proposed' then new.status in (
          'awaiting_hospital', 'awaiting_patient', 'confirmed',
          'cancellation_requested', 'cancelled', 'declined'
        )
        when 'confirmed' then new.status in (
          'in_progress', 'cancellation_requested', 'cancelled', 'completed'
        )
        when 'in_progress' then new.status in (
          'awaiting_patient', 'cancellation_requested', 'cancelled', 'completed'
        )
        when 'cancellation_requested' then new.status in (
          'confirmed', 'in_progress', 'cancelled'
        )
        else false
      end;

    if not transition_allowed then
      raise exception 'Unsupported patient request status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if new.service_id is not null then
    select s.hospital_id into service_hospital
      from public.hospital_services s
      where s.id = new.service_id;

    if service_hospital is distinct from new.hospital_id then
      raise exception 'The selected service belongs to a different hospital';
    end if;
  end if;

  if new.patient_record_id is not null then
    select p.hospital_id, (p.status = 'active')
      into record_hospital, record_is_active
      from public.patient_records p
      where p.id = new.patient_record_id;

    if record_hospital is distinct from new.hospital_id then
      raise exception 'The patient reference belongs to a different hospital';
    end if;

    if new.patient_record_id is distinct from old.patient_record_id
       and coalesce(record_is_active, false) is not true then
      raise exception 'A newly linked patient reference must be active';
    end if;
  end if;

  if new.status in ('completed', 'cancelled', 'declined') then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists patient_requests_integrity on public.patient_requests;
create trigger patient_requests_integrity
before insert or update on public.patient_requests
for each row execute function public.enforce_patient_request_integrity();

create or replace function public.enforce_appointment_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hospital uuid;
  request_type_value public.patient_request_type;
  actor_has_permission boolean;
  transition_allowed boolean := false;
begin
  if new.end_at <= new.start_at then
    raise exception 'Appointment end time must be after its start time';
  end if;

  select r.hospital_id, r.request_type
    into request_hospital, request_type_value
    from public.patient_requests r
    where r.id = new.patient_request_id;

  if request_hospital is distinct from new.hospital_id
     or request_type_value is distinct from 'appointment'::public.patient_request_type then
    raise exception 'An appointment must link to an appointment request in the same hospital';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'proposed' then
      raise exception 'A new appointment must start in proposed status';
    end if;

    select exists (
      select 1
      from public.hospital_memberships m
      join public.hospitals h on h.id = m.hospital_id
      where m.hospital_id = new.hospital_id
        and m.user_id = new.proposed_by
        and m.role in ('owner', 'admin', 'clinician', 'operations')
        and h.status = 'active'
    ) into actor_has_permission;

    if not coalesce(actor_has_permission, false) then
      raise exception 'An appointment proposal must be created by authorised active hospital staff';
    end if;
    return new;
  end if;

  if new.hospital_id is distinct from old.hospital_id
     or new.patient_request_id is distinct from old.patient_request_id
     or new.proposed_by is distinct from old.proposed_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Appointment identity and hospital scope cannot be changed';
  end if;

  if new.status is distinct from old.status then
    transition_allowed :=
      case old.status
        when 'proposed' then new.status in ('patient_accepted', 'reschedule_requested', 'cancelled')
        when 'patient_accepted' then new.status in ('confirmed', 'reschedule_requested', 'cancelled')
        when 'reschedule_requested' then new.status in ('proposed', 'cancelled')
        when 'confirmed' then new.status in ('reschedule_requested', 'cancelled', 'completed', 'no_show')
        else false
      end;

    if not transition_allowed then
      raise exception 'Unsupported appointment status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status = 'confirmed' and old.status is distinct from new.status then
    select exists (
      select 1
      from public.hospital_memberships m
      join public.hospitals h on h.id = m.hospital_id
      where m.hospital_id = new.hospital_id
        and m.user_id = new.confirmed_by
        and m.role in ('owner', 'admin', 'clinician', 'operations')
        and h.status = 'active'
    ) into actor_has_permission;

    if not coalesce(actor_has_permission, false) or new.confirmed_at is null then
      raise exception 'Appointment confirmation requires authorised active hospital staff and a confirmation timestamp';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_integrity on public.appointments;
create trigger appointments_integrity
before insert or update on public.appointments
for each row execute function public.enforce_appointment_integrity();

create or replace function public.enforce_work_item_patient_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_hospital uuid;
  request_record_id uuid;
  record_hospital uuid;
begin
  if new.patient_request_id is null then
    return new;
  end if;

  select r.hospital_id, r.patient_record_id
    into request_hospital, request_record_id
    from public.patient_requests r
    where r.id = new.patient_request_id;

  if request_hospital is distinct from new.hospital_id then
    raise exception 'A work item and its patient request must belong to the same hospital';
  end if;

  if new.patient_record_id is not null then
    select p.hospital_id into record_hospital
      from public.patient_records p
      where p.id = new.patient_record_id;

    if record_hospital is distinct from new.hospital_id then
      raise exception 'A work item patient reference must belong to its hospital';
    end if;
  end if;

  if new.patient_record_id is not null
     and request_record_id is not null
     and new.patient_record_id is distinct from request_record_id then
    raise exception 'A linked work item cannot reference a different patient record than its request';
  end if;

  return new;
end;
$$;

drop trigger if exists work_items_validate_patient_request on public.work_items;
create trigger work_items_validate_patient_request
before insert or update of hospital_id, patient_record_id, patient_request_id on public.work_items
for each row execute function public.enforce_work_item_patient_request();

-- Every new table starts from an explicit privilege baseline. This also
-- neutralises any broad default privileges inherited from the Supabase setup.
revoke all privileges on table
  public.patient_profiles,
  public.hospital_services,
  public.patient_requests,
  public.appointments
from public, anon, authenticated;

grant select on table
  public.patient_profiles,
  public.hospital_services,
  public.patient_requests,
  public.appointments
to authenticated;

grant select, insert, update, delete on table
  public.patient_profiles,
  public.hospital_services,
  public.patient_requests,
  public.appointments
to service_role;

alter table public.patient_profiles enable row level security;
alter table public.hospital_services enable row level security;
alter table public.patient_requests enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "Patients can read their own profile" on public.patient_profiles;
create policy "Patients can read their own profile"
on public.patient_profiles for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Hospital staff can read profiles related to their requests" on public.patient_profiles;
create policy "Hospital staff can read profiles related to their requests"
on public.patient_profiles for select to authenticated
using (
  exists (
    select 1
    from public.patient_requests r
    where r.patient_user_id = patient_profiles.user_id
      and public.is_hospital_member(r.hospital_id)
  )
);

drop policy if exists "Active hospital staff can read services" on public.hospital_services;
create policy "Active hospital staff can read services"
on public.hospital_services for select to authenticated
using (public.is_hospital_member(hospital_id));

drop policy if exists "Patients can read their own requests" on public.patient_requests;
create policy "Patients can read their own requests"
on public.patient_requests for select to authenticated
using (patient_user_id = (select auth.uid()));

drop policy if exists "Active hospital staff can read patient requests" on public.patient_requests;
create policy "Active hospital staff can read patient requests"
on public.patient_requests for select to authenticated
using (public.is_hospital_member(hospital_id));

drop policy if exists "Patients can read appointments for their own requests" on public.appointments;
create policy "Patients can read appointments for their own requests"
on public.appointments for select to authenticated
using (
  exists (
    select 1
    from public.patient_requests r
    where r.id = appointments.patient_request_id
      and r.patient_user_id = (select auth.uid())
  )
);

drop policy if exists "Active hospital staff can read appointments" on public.appointments;
create policy "Active hospital staff can read appointments"
on public.appointments for select to authenticated
using (public.is_hospital_member(hospital_id));

notify pgrst, 'reload schema';

commit;
