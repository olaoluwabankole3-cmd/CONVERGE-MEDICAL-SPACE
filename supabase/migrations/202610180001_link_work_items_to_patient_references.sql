-- Converge Medical Intelligence — link operational work to minimal patient references.
-- Apply after 202610170002_patient_reference_registry.sql.
-- This stores only the reference record ID; it does not copy patient identity into work items.

alter table public.work_items
  add column if not exists patient_record_id uuid
  references public.patient_records(id) on delete set null;

create index if not exists work_items_hospital_patient_record_idx
  on public.work_items(hospital_id, patient_record_id)
  where patient_record_id is not null;

create or replace function public.enforce_work_item_patient_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.patient_record_id is not null and not exists (
    select 1
    from public.patient_records p
    where p.id = new.patient_record_id
      and p.hospital_id = new.hospital_id
      and p.status = 'active'
  ) then
    raise exception 'The selected patient reference must be active and belong to this hospital';
  end if;
  return new;
end;
$$;

drop trigger if exists work_items_validate_patient_reference on public.work_items;
create trigger work_items_validate_patient_reference
before insert or update of hospital_id, patient_record_id on public.work_items
for each row execute function public.enforce_work_item_patient_reference();

notify pgrst, 'reload schema';
