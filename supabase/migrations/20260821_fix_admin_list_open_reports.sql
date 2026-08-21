-- PULSE fix: admin_list_open_reports was previously applied with an
-- ambiguous `id` reference (PL/pgSQL OUT parameter vs table column),
-- which made the moderation panel fail with "column reference id is ambiguous".
-- This recreates the function with fully qualified columns. Idempotent.
create or replace function public.admin_list_open_reports()
returns table (id uuid, event_id uuid, reason text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'ADMIN_REQUIRED';
  end if;
  return query
    select r.id, r.event_id, r.reason, r.status, r.created_at
    from public.event_reports r
    where r.status = 'open'
    order by r.created_at asc;
end;
$$;

grant execute on function public.admin_list_open_reports() to authenticated;
