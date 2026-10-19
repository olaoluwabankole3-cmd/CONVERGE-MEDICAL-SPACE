-- Restrict execution of SECURITY DEFINER membership helpers.
-- RLS policies require these functions for signed-in staff; anonymous callers do not.
begin;

revoke all on function public.is_hospital_member(uuid) from public, anon;
grant execute on function public.is_hospital_member(uuid) to authenticated, service_role;

revoke all on function public.has_hospital_role(uuid, public.hospital_member_role[]) from public, anon;
grant execute on function public.has_hospital_role(uuid, public.hospital_member_role[]) to authenticated, service_role;

commit;
