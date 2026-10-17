-- Converge Medical Intelligence — minimal hospital-scoped patient reference registry
-- Apply after 202610170001_tenant_isolation_hardening.sql.
-- This deliberately stores operational references, not names, diagnoses, or clinical notes.

do $$ begin
  create type public.patient_record_status as enum ('active', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.patient_records (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  reference_code text not null check (length(trim(reference_code)) between 2 and 80),
  external_reference text check (external_reference is null or length(external_reference) <= 120),
  care_area text check (care_area is null or length(care_area) <= 120),
  status public.patient_record_status not null default 'active',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, reference_code)
);

create index if not exists patient_records_hospital_status_idx
  on public.patient_records(hospital_id, status, updated_at desc);

drop trigger if exists patient_records_set_updated_at on public.patient_records;
create trigger patient_records_set_updated_at
before update on public.patient_records
for each row execute function public.set_updated_at();

create or replace function public.prevent_patient_record_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hospital_id is distinct from old.hospital_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Patient reference identity and hospital scope cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists patient_records_prevent_scope_change on public.patient_records;
create trigger patient_records_prevent_scope_change
before update on public.patient_records
for each row execute function public.prevent_patient_record_scope_change();

alter table public.patient_records enable row level security;

drop policy if exists "Active members can read hospital patient references" on public.patient_records;
create policy "Active members can read hospital patient references"
on public.patient_records for select to authenticated
using (public.is_hospital_member(hospital_id));

drop policy if exists "Permitted staff can create patient references" on public.patient_records;
create policy "Permitted staff can create patient references"
on public.patient_records for insert to authenticated
with check (
  created_by = (select auth.uid())
  and status = 'active'
  and public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations']::public.hospital_member_role[])
);

drop policy if exists "Permitted staff can update patient references" on public.patient_records;
create policy "Permitted staff can update patient references"
on public.patient_records for update to authenticated
using (public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations','reviewer']::public.hospital_member_role[]))
with check (public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations','reviewer']::public.hospital_member_role[]));

drop policy if exists "Hospital admins can delete patient references" on public.patient_records;
create policy "Hospital admins can delete patient references"
on public.patient_records for delete to authenticated
using (public.has_hospital_role(hospital_id, array['owner','admin']::public.hospital_member_role[]));

grant select, insert, update, delete on public.patient_records to authenticated;

notify pgrst, 'reload schema';
