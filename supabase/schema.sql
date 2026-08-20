-- PULSE production schema
-- Run this once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  city text not null default 'Орск',
  avatar_url text,
  notifications boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('city', 'vibe', 'street', 'help')),
  category text not null,
  title text not null check (char_length(title) between 3 and 80),
  description text not null check (char_length(description) between 3 and 500),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location geography(point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  avatar_url text,
  reactions integer not null default 0 check (reactions >= 0),
  comments integer not null default 0 check (comments >= 0),
  created_at timestamptz not null default now()
);

create index if not exists events_location_idx on public.events using gist (location);
create index if not exists events_created_at_idx on public.events (created_at desc);

alter table public.profiles add column if not exists avatar_url text;
alter table public.events add column if not exists avatar_url text;

alter table public.profiles enable row level security;
alter table public.events enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Profiles are editable by owner" on public.profiles;
create policy "Profiles are editable by owner" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Events are public" on public.events;
create policy "Events are public" on public.events for select using (true);
-- Inserts happen through create_event() so the rate limit cannot be bypassed from the anon client.
drop policy if exists "Events are inserted through RPC" on public.events;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') = 'anonymous' then return new; end if;
  insert into public.profiles (id, name, avatar_url)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)), nullif(new.raw_user_meta_data ->> 'avatar_url', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.create_event(
  p_kind text,
  p_category text,
  p_title text,
  p_description text,
  p_lat double precision,
  p_lng double precision
)
returns public.events
language plpgsql
security definer set search_path = public
as $$
declare
  new_event public.events;
  recent_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  select count(*) into recent_count from public.events
    where user_id = auth.uid() and created_at > now() - interval '10 minutes';
  if recent_count >= 5 then raise exception 'RATE_LIMIT'; end if;
  if char_length(trim(p_title)) < 3 or char_length(trim(p_description)) < 3 then raise exception 'INVALID_CONTENT'; end if;

  insert into public.events (kind, category, title, description, lat, lng, user_id, user_name, avatar_url)
  select p_kind, p_category, trim(p_title), trim(p_description), p_lat, p_lng, auth.uid(), profiles.name, profiles.avatar_url
  from public.profiles where profiles.id = auth.uid()
  returning * into new_event;
  return new_event;
end;
$$;

grant execute on function public.create_event(text, text, text, text, double precision, double precision) to authenticated;

-- Enable this table for Supabase Realtime once per project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;
