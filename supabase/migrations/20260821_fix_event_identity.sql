-- PULSE fix: never return an event without the author's profile identity.
-- Events are still created only through this security-definer RPC from the client.

update public.events as e
set user_name = coalesce(nullif(btrim(p.name), ''), e.user_name),
    avatar_url = coalesce(nullif(btrim(p.avatar_url), ''), e.avatar_url)
from public.profiles as p
where p.id = e.user_id
  and (nullif(btrim(e.user_name), '') is null or nullif(btrim(e.avatar_url), '') is null);

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
security definer
set search_path = public
as $$
declare
  new_event public.events;
  recent_count integer;
  profile_name text;
  profile_avatar text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if char_length(trim(p_title)) < 3 or char_length(trim(p_title)) > 80 then raise exception 'INVALID_CONTENT'; end if;
  if char_length(trim(p_description)) < 3 or char_length(trim(p_description)) > 500 then raise exception 'INVALID_CONTENT'; end if;

  select nullif(btrim(p.name), ''), nullif(btrim(p.avatar_url), '')
    into profile_name, profile_avatar
  from public.profiles as p
  where p.id = auth.uid();

  profile_name := coalesce(profile_name, nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''), nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''), 'Пользователь');

  select count(*) into recent_count
  from public.events as e
  where e.user_id = auth.uid()
    and e.created_at > now() - interval '10 minutes';
  if recent_count >= 5 then raise exception 'RATE_LIMIT'; end if;

  insert into public.events (kind, category, title, description, lat, lng, user_id, user_name, avatar_url)
  values (p_kind, p_category, trim(p_title), trim(p_description), p_lat, p_lng, auth.uid(), profile_name, profile_avatar)
  returning * into new_event;

  return new_event;
end;
$$;

grant execute on function public.create_event(text, text, text, text, double precision, double precision) to authenticated;
notify pgrst, 'reload schema';
