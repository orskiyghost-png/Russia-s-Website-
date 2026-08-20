-- PULSE phase 1: persistent reactions and comments.
-- Do not edit supabase/schema.sql; apply this migration in Supabase SQL Editor.

create table if not exists public.event_reactions (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_reactions_user_idx on public.event_reactions(user_id);

alter table public.event_reactions enable row level security;

drop policy if exists "Users can read their own reactions" on public.event_reactions;
create policy "Users can read their own reactions"
  on public.event_reactions for select
  using (auth.uid() = user_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  avatar_url text,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists comments_event_created_idx on public.comments(event_id, created_at asc);

alter table public.comments enable row level security;

drop policy if exists "Comments are public" on public.comments;
create policy "Comments are public"
  on public.comments for select
  using (true);

drop policy if exists "Authors can delete comments" on public.comments;
create policy "Authors can delete comments"
  on public.comments for delete
  using (auth.uid() = user_id);

create or replace function public.toggle_reaction(p_event_id uuid)
returns table(reactions integer, liked_by_me boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  is_liked boolean;
  reaction_count integer;
begin
  if current_user_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED';
  end if;

  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if exists (select 1 from public.event_reactions where event_id = p_event_id and user_id = current_user_id) then
    delete from public.event_reactions where event_id = p_event_id and user_id = current_user_id;
    is_liked := false;
  else
    insert into public.event_reactions(event_id, user_id) values (p_event_id, current_user_id);
    is_liked := true;
  end if;

  select count(*)::integer into reaction_count from public.event_reactions where event_id = p_event_id;
  update public.events set reactions = reaction_count where id = p_event_id;
  return query select reaction_count, is_liked;
end;
$$;

create or replace function public.add_comment(p_event_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  clean_body text := btrim(p_body);
  profile_row public.profiles%rowtype;
  inserted_row public.comments%rowtype;
  comments_count integer;
begin
  if current_user_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 500 then
    raise exception 'INVALID_COMMENT';
  end if;
  if (select count(*) from public.comments where user_id = current_user_id and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'COMMENT_RATE_LIMIT';
  end if;

  select * into profile_row from public.profiles where id = current_user_id;
  insert into public.comments(event_id, user_id, user_name, avatar_url, body)
    values (p_event_id, current_user_id, coalesce(profile_row.name, 'Пользователь'), profile_row.avatar_url, clean_body)
    returning * into inserted_row;

  select count(*)::integer into comments_count from public.comments where event_id = p_event_id;
  update public.events set comments = comments_count where id = p_event_id;

  return jsonb_build_object(
    'id', inserted_row.id,
    'user_name', inserted_row.user_name,
    'avatar_url', inserted_row.avatar_url,
    'body', inserted_row.body,
    'created_at', inserted_row.created_at,
    'comments_count', comments_count
  );
end;
$$;

grant execute on function public.toggle_reaction(uuid) to authenticated;
grant execute on function public.add_comment(uuid, text) to authenticated;
