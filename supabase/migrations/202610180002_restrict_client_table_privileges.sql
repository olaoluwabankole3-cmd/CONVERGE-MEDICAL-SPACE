-- Converge Medical Intelligence — restrict direct client database privileges.
-- Apply after 202610180001_link_work_items_to_patient_references.sql.
--
-- The live schema audit found excessive table-level privileges for anon and
-- authenticated. RLS does not replace table privileges (for example, TRUNCATE
-- is not constrained by row-level policies). Preserve service_role privileges;
-- server-side APIs use that role only after application-level authorization.
--
-- This migration intentionally touches only the five existing application
-- tables identified in the live schema audit. It does not create or rename
-- application objects and does not alter any data.

begin;

-- Remove broad client and PUBLIC privileges, including TRUNCATE, MAINTAIN,
-- TRIGGER, REFERENCES, and direct writes that are not required by the UI.
revoke all privileges on table
  public.hospitals,
  public.hospital_memberships,
  public.work_items,
  public.patient_records,
  public.audit_events
from public, anon, authenticated;

-- Hospital registration and reading the signed-in user's workspace.
grant select, insert on table public.hospitals to authenticated;

-- Initial owner membership creation is protected by its dedicated INSERT
-- policy. Team changes continue through the server-side team API.
grant select, insert on table public.hospital_memberships to authenticated;

-- Existing staff UI reads, creates, updates, and (where policy permits) deletes
-- operational work items. RLS and the existing scope/owner triggers still apply.
grant select, insert, update, delete on table public.work_items to authenticated;

-- Existing reference directory supports reading, creating, archiving/reactivating,
-- and the admin-only delete policy. Tenant and role RLS policies still apply.
grant select, insert, update, delete on table public.patient_records to authenticated;

-- The current app can read and append audit events, but not rewrite or delete
-- existing history through a direct client table request.
grant select, insert on table public.audit_events to authenticated;

-- Do not leave client access to public-schema sequences that might allow
-- clients to consume sequence values. Keep the identity sequence needed by
-- audit_events inserts available to authenticated users.
revoke all privileges on all sequences in schema public
from public, anon, authenticated;

do $$
declare
  audit_sequence text;
begin
  audit_sequence := pg_get_serial_sequence('public.audit_events', 'id');
  if audit_sequence is not null then
    execute format('grant usage, select on sequence %s to authenticated', audit_sequence);
  end if;
end;
$$;

-- Remove the broad ALL policy: membership updates and removals are performed
-- by the server-side team API after explicit role and target checks. Keep the
-- SELECT policy and the narrowly-scoped initial membership INSERT policy.
drop policy if exists "Hospital admins can manage memberships"
  on public.hospital_memberships;

notify pgrst, 'reload schema';

commit;
