-- Converge Medical Intelligence — tenant-boundary hardening
-- Apply after 202610160001_initial_schema.sql in the Supabase SQL Editor.
-- Prevent client-side updates from moving records between hospital tenants.

create or replace function public.prevent_hospital_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'hospital_memberships' then
    if new.hospital_id is distinct from old.hospital_id
       or new.user_id is distinct from old.user_id then
      raise exception 'Membership identity and hospital scope cannot be changed';
    end if;
  elsif tg_table_name = 'work_items' then
    if new.hospital_id is distinct from old.hospital_id then
      raise exception 'A work item cannot be moved between hospital workspaces';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_prevent_scope_change on public.hospital_memberships;
create trigger memberships_prevent_scope_change
before update on public.hospital_memberships
for each row execute function public.prevent_hospital_scope_change();

drop trigger if exists work_items_prevent_scope_change on public.work_items;
create trigger work_items_prevent_scope_change
before update on public.work_items
for each row execute function public.prevent_hospital_scope_change();

create or replace function public.enforce_work_item_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and not exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = new.hospital_id
      and m.user_id = new.owner_id
      and h.status = 'active'
  ) then
    raise exception 'Assigned staff must be an active member of this hospital';
  end if;
  return new;
end;
$$;

drop trigger if exists work_items_validate_owner on public.work_items;
create trigger work_items_validate_owner
before insert or update of hospital_id, owner_id on public.work_items
for each row execute function public.enforce_work_item_owner_membership();
