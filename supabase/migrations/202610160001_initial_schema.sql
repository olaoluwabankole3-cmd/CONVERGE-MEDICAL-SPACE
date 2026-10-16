-- Converge Medical Intelligence — initial multi-hospital data model
-- Apply in Supabase SQL Editor or with the Supabase CLI.
-- All operational records are scoped to a hospital. RLS is enabled from day one.
-- This migration intentionally does not grant public/anonymous access to clinical workflows.

create extension if not exists pgcrypto;

create type public.hospital_status as enum ('pending', 'active', 'rejected', 'suspended');
create type public.hospital_member_role as enum ('owner', 'admin', 'clinician', 'operations', 'reviewer');
create type public.work_item_type as enum ('access_case', 'appointment', 'follow_up', 'exception', 'task');
create type public.work_item_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.work_item_status as enum ('draft', 'open', 'needs_review', 'in_progress', 'awaiting_response', 'resolved', 'closed');

create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 180),
  registration_number text,
  country text not null default 'Nigeria',
  city text,
  contact_email text not null,
  status public.hospital_status not null default 'pending',
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hospital_memberships (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.hospital_member_role not null default 'operations',
  created_at timestamptz not null default now(),
  unique (hospital_id, user_id)
);

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  reference_code text not null,
  title text not null check (length(trim(title)) between 3 and 240),
  summary text,
  item_type public.work_item_type not null default 'access_case',
  priority public.work_item_priority not null default 'medium',
  status public.work_item_status not null default 'draft',
  owner_id uuid references auth.users(id) on delete set null,
  external_reference text,
  due_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, reference_code)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index hospitals_status_created_idx on public.hospitals(status, created_at desc);
create index memberships_user_hospital_idx on public.hospital_memberships(user_id, hospital_id);
create index work_items_hospital_status_idx on public.work_items(hospital_id, status, created_at desc);
create index work_items_hospital_type_idx on public.work_items(hospital_id, item_type, priority);
create index audit_events_hospital_created_idx on public.audit_events(hospital_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger hospitals_set_updated_at before update on public.hospitals
for each row execute function public.set_updated_at();
create trigger work_items_set_updated_at before update on public.work_items
for each row execute function public.set_updated_at();

-- Helpers are SECURITY DEFINER to avoid recursive membership-policy evaluation.
create or replace function public.is_hospital_member(target_hospital uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = target_hospital
      and m.user_id = (select auth.uid())
      and h.status = 'active'
  );
$$;

create or replace function public.has_hospital_role(target_hospital uuid, allowed_roles public.hospital_member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hospital_memberships m
    join public.hospitals h on h.id = m.hospital_id
    where m.hospital_id = target_hospital
      and m.user_id = (select auth.uid())
      and m.role = any(allowed_roles)
      and h.status = 'active'
  );
$$;

alter table public.hospitals enable row level security;
alter table public.hospital_memberships enable row level security;
alter table public.work_items enable row level security;
alter table public.audit_events enable row level security;

-- A signed-in user may register a hospital, but it remains pending until approved.
create policy "Users can register a pending hospital"
on public.hospitals for insert to authenticated
with check (
  created_by = (select auth.uid())
  and status = 'pending'
  and approved_by is null
  and approved_at is null
);

create policy "Hospital creators can view their registration"
on public.hospitals for select to authenticated
using (
  created_by = (select auth.uid())
  or public.is_hospital_member(id)
);

-- A creator can add themselves to the pending hospital they just registered.
create policy "Creators can create their own initial membership"
on public.hospital_memberships for insert to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (
    select 1 from public.hospitals h
    where h.id = hospital_id
      and h.created_by = (select auth.uid())
      and h.status = 'pending'
  )
);

create policy "Active hospital members can view memberships"
on public.hospital_memberships for select to authenticated
using (public.is_hospital_member(hospital_id));

create policy "Hospital admins can manage memberships"
on public.hospital_memberships for all to authenticated
using (public.has_hospital_role(hospital_id, array['owner','admin']::public.hospital_member_role[]))
with check (public.has_hospital_role(hospital_id, array['owner','admin']::public.hospital_member_role[]));

create policy "Active hospital members can read work items"
on public.work_items for select to authenticated
using (public.is_hospital_member(hospital_id));

create policy "Operations roles can create work items"
on public.work_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations']::public.hospital_member_role[])
);

create policy "Permitted members can update work items"
on public.work_items for update to authenticated
using (public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations','reviewer']::public.hospital_member_role[]))
with check (public.has_hospital_role(hospital_id, array['owner','admin','clinician','operations','reviewer']::public.hospital_member_role[]));

create policy "Admins can delete work items"
on public.work_items for delete to authenticated
using (public.has_hospital_role(hospital_id, array['owner','admin']::public.hospital_member_role[]));

create policy "Active hospital members can read audit events"
on public.audit_events for select to authenticated
using (public.is_hospital_member(hospital_id));

create policy "Members can append audit events"
on public.audit_events for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and public.is_hospital_member(hospital_id)
);

grant usage on schema public to authenticated;
grant select, insert on public.hospitals to authenticated;
grant select, insert, update, delete on public.hospital_memberships to authenticated;
grant select, insert, update, delete on public.work_items to authenticated;
grant select, insert on public.audit_events to authenticated;
