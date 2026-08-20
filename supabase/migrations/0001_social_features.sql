-- ============================================================
-- PULSE — ПОЛНЫЙ НАБОР SQL ДЛЯ SUPABASE
-- ============================================================
-- Вставьте ВЕСЬ этот текст в Supabase SQL Editor и нажмите Run.
-- Его можно запускать повторно — это безопасно.
-- ============================================================

-- ============ БАЗОВАЯ СХЕМА (profiles, events, create_event) ============

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
drop policy if exists "Events are inserted through RPC" on public.events;

drop function if exists public.handle_new_user() cascade;
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

drop function if exists public.create_event(text, text, text, text, double precision, double precision) cascade;
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

-- ============ НОВЫЕ ВОЗМОЖНОСТИ (лайки, комментарии, жалобы, сообщения) ============

alter table public.profiles add column if not exists bio text check (char_length(bio) <= 240);
alter table public.profiles add column if not exists neighborhood text check (char_length(neighborhood) <= 120);
alter table public.profiles add column if not exists role text not null default 'user' check (role in ('user', 'admin'));

alter table public.events add column if not exists address text;
alter table public.events add column if not exists moderation_status text not null default 'published' check (moderation_status in ('published', 'hidden', 'removed'));
create index if not exists events_moderation_idx on public.events (moderation_status, created_at desc);

create table if not exists public.event_reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.event_reactions enable row level security;
drop policy if exists "Reactions are readable by owner" on public.event_reactions;
create policy "Reactions are readable by owner" on public.event_reactions for select using (auth.uid() = user_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  avatar_url text,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_event_idx on public.comments (event_id, created_at);
alter table public.comments enable row level security;
drop policy if exists "Comments are public" on public.comments;
create policy "Comments are public" on public.comments for select using (true);

create table if not exists public.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists event_reports_status_idx on public.event_reports (status, created_at desc);
alter table public.event_reports enable row level security;

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists direct_messages_participants_idx on public.direct_messages (sender_id, recipient_id, created_at);
create index if not exists direct_messages_recipient_idx on public.direct_messages (recipient_id, created_at);
alter table public.direct_messages enable row level security;

drop function if exists public.set_event_address(uuid, text) cascade;
create or replace function public.set_event_address(p_event_id uuid, p_address text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.events set address = nullif(trim(p_address), '')
  where id = p_event_id and user_id = auth.uid();
end;
$$;
grant execute on function public.set_event_address(uuid, text) to authenticated;

drop function if exists public.toggle_reaction(uuid) cascade;
create or replace function public.toggle_reaction(p_event_id uuid)
returns table (reactions integer, liked_by_me boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  is_liked boolean;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'EVENT_NOT_FOUND'; end if;

  select exists(
    select 1 from public.event_reactions where user_id = current_user_id and event_id = p_event_id
  ) into is_liked;

  if is_liked then
    delete from public.event_reactions where user_id = current_user_id and event_id = p_event_id;
    update public.events set reactions = greatest(0, reactions - 1) where id = p_event_id;
  else
    insert into public.event_reactions (user_id, event_id) values (current_user_id, p_event_id);
    update public.events set reactions = reactions + 1 where id = p_event_id;
  end if;

  return query
    select e.reactions, exists(
      select 1 from public.event_reactions r where r.user_id = current_user_id and r.event_id = e.id
    )
    from public.events e where e.id = p_event_id;
end;
$$;
grant execute on function public.toggle_reaction(uuid) to authenticated;

drop function if exists public.add_comment(uuid, text) cascade;
create or replace function public.add_comment(p_event_id uuid, p_body text)
returns table (id uuid, user_name text, avatar_url text, body text, created_at timestamptz, comments_count integer)
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  author public.profiles%rowtype;
  recent_count integer;
  new_comment public.comments;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if char_length(trim(p_body)) < 1 or char_length(trim(p_body)) > 500 then raise exception 'INVALID_CONTENT'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'EVENT_NOT_FOUND'; end if;

  select count(*) into recent_count from public.comments
    where user_id = current_user_id and created_at > now() - interval '5 minutes';
  if recent_count >= 10 then raise exception 'COMMENT_RATE_LIMIT'; end if;

  select * into author from public.profiles where id = current_user_id;

  insert into public.comments (event_id, user_id, user_name, avatar_url, body)
  values (p_event_id, current_user_id, coalesce(author.name, 'Пользователь'), author.avatar_url, trim(p_body))
  returning * into new_comment;

  update public.events set comments = comments + 1 where id = p_event_id;

  return query
    select new_comment.id, new_comment.user_name, new_comment.avatar_url, new_comment.body, new_comment.created_at,
      (select e.comments from public.events e where e.id = p_event_id);
end;
$$;
grant execute on function public.add_comment(uuid, text) to authenticated;

drop function if exists public.create_event_report(uuid, text) cascade;
create or replace function public.create_event_report(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if char_length(trim(p_reason)) < 3 or char_length(trim(p_reason)) > 300 then raise exception 'INVALID_CONTENT'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'EVENT_NOT_FOUND'; end if;
  if exists (
    select 1 from public.event_reports
    where event_id = p_event_id and user_id = current_user_id and status = 'open'
  ) then raise exception 'ALREADY_REPORTED'; end if;

  insert into public.event_reports (event_id, user_id, reason)
  values (p_event_id, current_user_id, trim(p_reason));
end;
$$;
grant execute on function public.create_event_report(uuid, text) to authenticated;

drop function if exists public.admin_list_open_reports() cascade;
create or replace function public.admin_list_open_reports()
returns table (id uuid, event_id uuid, reason text, status text, created_at timestamptz)
language plpgsql
security definer set search_path = public
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

drop function if exists public.admin_set_event_status(uuid, text) cascade;
create or replace function public.admin_set_event_status(p_event_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_status not in ('published', 'hidden', 'removed') then raise exception 'INVALID_STATUS'; end if;
  update public.events set moderation_status = p_status where id = p_event_id;
  update public.event_reports set status = 'reviewed' where event_id = p_event_id and status = 'open';
end;
$$;
grant execute on function public.admin_set_event_status(uuid, text) to authenticated;

drop function if exists public.send_direct_message(uuid, text) cascade;
create or replace function public.send_direct_message(p_recipient_id uuid, p_body text)
returns table (id uuid, sender_id uuid, recipient_id uuid, body text, created_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_message public.direct_messages;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if p_recipient_id = current_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if char_length(trim(p_body)) < 1 or char_length(trim(p_body)) > 1000 then raise exception 'INVALID_CONTENT'; end if;
  if not exists (select 1 from auth.users where id = p_recipient_id) then raise exception 'RECIPIENT_NOT_FOUND'; end if;

  insert into public.direct_messages (sender_id, recipient_id, body)
  values (current_user_id, p_recipient_id, trim(p_body))
  returning * into new_message;

  return query
    select new_message.id, new_message.sender_id, new_message.recipient_id, new_message.body, new_message.created_at;
end;
$$;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

drop function if exists public.list_direct_messages(uuid) cascade;
create or replace function public.list_direct_messages(p_other_user_id uuid)
returns table (id uuid, sender_id uuid, recipient_id uuid, body text, created_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
    select m.id, m.sender_id, m.recipient_id, m.body, m.created_at
    from public.direct_messages m
    where (m.sender_id = current_user_id and m.recipient_id = p_other_user_id)
       or (m.sender_id = p_other_user_id and m.recipient_id = current_user_id)
    order by m.created_at asc;
end;
$$;
grant execute on function public.list_direct_messages(uuid) to authenticated;
