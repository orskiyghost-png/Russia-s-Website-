-- HOTFIX: safe "create or replace" for admin_list_open_reports.
-- This resolves the "column reference id is ambiguous" error by using
-- explicit table aliases and qualified column names everywhere.
-- Run this in Supabase SQL Editor after applying 20260821_fix_event_identity.sql.

-- Step 1: drop any existing version first (idempotent, safe).
drop function if exists public.admin_list_open_reports();

-- Step 2: recreate with fully qualified columns — no ambiguity.
create or replace function public.admin_list_open_reports()
returns table (
  id uuid,
  event_id uuid,
  reason text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles as p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
    select r.id, r.event_id, r.reason, r.status, r.created_at
    from public.event_reports as r
    where r.status = 'open'
    order by r.created_at asc;
end;
$$;

grant execute on function public.admin_list_open_reports() to authenticated;

-- Force PostgREST to reload schema cache.
notify pgrst, 'reload schema';
