-- PULSE anonymous access hardening.
-- Anonymous users may read public events, but only permanent accounts may create persistent signals.
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
