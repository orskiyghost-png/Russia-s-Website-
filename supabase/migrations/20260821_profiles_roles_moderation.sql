-- PULSE phase 6: extended profiles, roles and moderation.
-- Apply after the existing PULSE migrations. Do not edit schema.sql or old migrations.

alter table public.profiles
  add column if not exists bio text,
  add column if not exists neighborhood text,
  add column if not exists role text not null default 'user',
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin'));

alter table public.events
  add column if not exists moderation_status text not null default 'published',
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id);

alter table public.events
  drop constraint if exists events_moderation_status_check;

alter table public.events
  add constraint events_moderation_status_check check (moderation_status in ('published', 'hidden', 'removed'));

create index if not exists events_moderation_status_created_idx on public.events(moderation_status, created_at desc);

create table if not exists public.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 240),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, reporter_id)
);

create index if not exists event_reports_status_created_idx on public.event_reports(status, created_at desc);

alter table public.event_reports enable row level security;

drop policy if exists "Users can create reports" on public.event_reports;
create policy "Users can create reports"
  on public.event_reports for insert
  with check (auth.uid() = reporter_id);

create or replace function public.is_pulse_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_pulse_admin() to authenticated;

create or replace function public.create_event_report(p_event_id uuid, p_reason text)
returns public.event_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  created_report public.event_reports;
  clean_reason text := nullif(left(btrim(p_reason), 240), '');
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED';
  end if;
  if clean_reason is null then raise exception 'INVALID_REPORT'; end if;
  insert into public.event_reports(event_id, reporter_id, reason)
    values (p_event_id, auth.uid(), clean_reason)
    returning * into created_report;
  return created_report;
exception when unique_violation then
  raise exception 'REPORT_ALREADY_EXISTS';
end;
$$;

grant execute on function public.create_event_report(uuid, text) to authenticated;

create or replace function public.admin_set_event_status(p_event_id uuid, p_status text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_event public.events;
begin
  if not public.is_pulse_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status not in ('published', 'hidden', 'removed') then raise exception 'INVALID_MODERATION_STATUS'; end if;
  update public.events
    set moderation_status = p_status, moderated_at = now(), moderated_by = auth.uid()
    where id = p_event_id
    returning * into updated_event;
  if updated_event.id is null then raise exception 'EVENT_NOT_FOUND'; end if;
  return updated_event;
end;
$$;

grant execute on function public.admin_set_event_status(uuid, text) to authenticated;

create or replace function public.admin_list_open_reports()
returns setof public.event_reports
language sql
security definer
set search_path = public
as $$
  select * from public.event_reports
  where public.is_pulse_admin() and status = 'open'
  order by created_at desc;
$$;

grant execute on function public.admin_list_open_reports() to authenticated;

notify pgrst, 'reload schema';
