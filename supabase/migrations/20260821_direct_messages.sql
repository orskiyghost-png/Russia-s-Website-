-- PULSE phase 7: direct messages between permanent users.
-- Apply after profile/role migrations; guests and anonymous users are excluded.

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists direct_messages_conversation_idx on public.direct_messages(sender_id, recipient_id, created_at asc);
create index if not exists direct_messages_recipient_idx on public.direct_messages(recipient_id, created_at desc);

alter table public.direct_messages enable row level security;

drop policy if exists "Participants can read messages" on public.direct_messages;
create policy "Participants can read messages"
  on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create or replace function public.send_direct_message(p_recipient_id uuid, p_body text)
returns public.direct_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.direct_messages;
  clean_body text := nullif(btrim(p_body), '');
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if p_recipient_id = auth.uid() then raise exception 'INVALID_RECIPIENT'; end if;
  if clean_body is null then raise exception 'INVALID_MESSAGE'; end if;
  if not exists (select 1 from auth.users where id = p_recipient_id) then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  insert into public.direct_messages(sender_id, recipient_id, body)
    values (auth.uid(), p_recipient_id, left(clean_body, 1000))
    returning * into message_row;
  return message_row;
end;
$$;

grant execute on function public.send_direct_message(uuid, text) to authenticated;

create or replace function public.list_direct_messages(p_other_user_id uuid)
returns setof public.direct_messages
language sql
security definer
set search_path = public
as $$
  select * from public.direct_messages
  where (sender_id = auth.uid() and recipient_id = p_other_user_id)
     or (sender_id = p_other_user_id and recipient_id = auth.uid())
  order by created_at asc
  limit 100;
$$;

grant execute on function public.list_direct_messages(uuid) to authenticated;

notify pgrst, 'reload schema';
