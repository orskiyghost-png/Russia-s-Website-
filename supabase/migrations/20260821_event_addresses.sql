-- PULSE phase 5: human-readable event addresses.
-- Keep create_event(p_kind, p_category, p_title, p_description, p_lat, p_lng) unchanged.

alter table public.events
  add column if not exists address text;

create or replace function public.set_event_address(p_event_id uuid, p_address text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_event public.events;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.events
  set address = nullif(left(trim(p_address), 240), '')
  where id = p_event_id
    and user_id = auth.uid()
  returning * into updated_event;

  if updated_event.id is null then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  return updated_event;
end;
$$;

revoke all on function public.set_event_address(uuid, text) from public;
grant execute on function public.set_event_address(uuid, text) to authenticated;

comment on column public.events.address is 'Human-readable address resolved from event coordinates at creation time.';
comment on function public.set_event_address(uuid, text) is 'Stores a reverse-geocoded address for an event without changing create_event compatibility.';

notify pgrst, 'reload schema';
