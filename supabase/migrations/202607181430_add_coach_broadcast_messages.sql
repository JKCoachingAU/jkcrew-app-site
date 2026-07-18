alter table public.push_preferences
  add column if not exists coach_messages boolean not null default true;

create table if not exists public.coach_broadcasts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null default 'Coach',
  target_type text not null check (target_type in ('everyone', 'riders', 'parents', 'group', 'athlete')),
  target_value text not null default '',
  target_label text not null default '',
  message text not null check (char_length(btrim(message)) between 1 and 500),
  recipient_count integer not null default 0,
  push_count integer not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists coach_broadcasts_coach_sent_idx
  on public.coach_broadcasts (coach_id, sent_at desc);
create index if not exists coach_broadcasts_active_idx
  on public.coach_broadcasts (expires_at, sent_at desc);

create table if not exists public.coach_broadcast_recipients (
  broadcast_id uuid not null references public.coach_broadcasts(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (broadcast_id, recipient_id)
);

create index if not exists coach_broadcast_recipients_user_idx
  on public.coach_broadcast_recipients (recipient_id, created_at desc);

alter table public.coach_broadcasts enable row level security;
alter table public.coach_broadcast_recipients enable row level security;

drop policy if exists "Coaches view own broadcasts" on public.coach_broadcasts;
create policy "Coaches view own broadcasts"
  on public.coach_broadcasts for select to authenticated
  using ((select auth.uid()) = coach_id);

drop policy if exists "Recipients view addressed broadcasts" on public.coach_broadcasts;
create policy "Recipients view addressed broadcasts"
  on public.coach_broadcasts for select to authenticated
  using (
    exists (
      select 1
      from public.coach_broadcast_recipients recipient
      where recipient.broadcast_id = coach_broadcasts.id
        and recipient.recipient_id = (select auth.uid())
    )
  );

drop policy if exists "Recipients view own message links" on public.coach_broadcast_recipients;
create policy "Recipients view own message links"
  on public.coach_broadcast_recipients for select to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on public.coach_broadcasts from anon, authenticated;
revoke all on public.coach_broadcast_recipients from anon, authenticated;
grant select on public.coach_broadcasts to authenticated;
grant select on public.coach_broadcast_recipients to authenticated;

create or replace function public.get_my_coach_messages(p_limit integer default 3)
returns table (
  id uuid,
  sender_name text,
  target_label text,
  message text,
  sent_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    broadcast.id,
    broadcast.sender_name,
    broadcast.target_label,
    broadcast.message,
    broadcast.sent_at,
    broadcast.expires_at
  from public.coach_broadcast_recipients recipient
  join public.coach_broadcasts broadcast on broadcast.id = recipient.broadcast_id
  where recipient.recipient_id = (select auth.uid())
    and broadcast.expires_at > now()
  order by broadcast.sent_at desc
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$function$;

revoke all on function public.get_my_coach_messages(integer) from public, anon;
grant execute on function public.get_my_coach_messages(integer) to authenticated;

create or replace function public.send_coach_broadcast(
  p_target_type text,
  p_target_value text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_coach_id uuid := auth.uid();
  v_coach_name text;
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_target_value text := lower(btrim(coalesce(p_target_value, '')));
  v_target_label text;
  v_message text := regexp_replace(btrim(coalesce(p_message, '')), '[[:space:]]+', ' ', 'g');
  v_broadcast_id uuid;
  v_target_athlete_id uuid;
  v_recipient_count integer := 0;
  v_push_count integer := 0;
begin
  select profile.display_name
  into v_coach_name
  from public.profiles profile
  where profile.id = v_coach_id
    and profile.role::text in ('coach', 'admin');

  if v_coach_name is null then
    raise exception 'Only coach/admin accounts can send coach messages.';
  end if;

  if v_target_type not in ('everyone', 'riders', 'parents', 'group', 'athlete') then
    raise exception 'Choose a valid message audience.';
  end if;

  if char_length(v_message) < 1 or char_length(v_message) > 500 then
    raise exception 'Coach messages must be between 1 and 500 characters.';
  end if;

  if v_target_type = 'group' then
    if v_target_value not in ('monday', 'tuesday', 'wednesday', 'online') then
      raise exception 'Choose a valid training group.';
    end if;
    v_target_label := case v_target_value
      when 'monday' then 'Monday Team'
      when 'tuesday' then 'Tuesday Team'
      when 'wednesday' then 'Wednesday Team'
      when 'online' then 'Online Training'
    end;
  elsif v_target_type = 'athlete' then
    begin
      v_target_athlete_id := nullif(v_target_value, '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Choose a valid rider.';
    end;

    select athlete.display_name
    into v_target_label
    from public.coach_athletes link
    join public.profiles athlete on athlete.id = link.athlete_id
    where link.coach_id = v_coach_id
      and link.athlete_id = v_target_athlete_id;

    if v_target_label is null then
      raise exception 'That rider is not linked to your coach account.';
    end if;
  else
    v_target_label := case v_target_type
      when 'everyone' then 'All riders and parents'
      when 'riders' then 'All riders'
      when 'parents' then 'All parents'
    end;
  end if;

  insert into public.coach_broadcasts (
    coach_id,
    sender_name,
    target_type,
    target_value,
    target_label,
    message
  ) values (
    v_coach_id,
    v_coach_name,
    v_target_type,
    coalesce(v_target_value, ''),
    v_target_label,
    v_message
  )
  returning id into v_broadcast_id;

  insert into public.coach_broadcast_recipients (broadcast_id, recipient_id)
  select v_broadcast_id, candidate.recipient_id
  from (
    select link.athlete_id as recipient_id
    from public.coach_athletes link
    where link.coach_id = v_coach_id
      and (
        v_target_type in ('everyone', 'riders')
        or (v_target_type = 'athlete' and link.athlete_id = v_target_athlete_id)
        or (
          v_target_type = 'group'
          and (
            lower(link.group_name) = v_target_value
            or exists (
              select 1
              from public.coach_athlete_groups membership
              where membership.coach_id = v_coach_id
                and membership.athlete_id = link.athlete_id
                and lower(membership.group_name) = v_target_value
                and (
                  membership.membership_type <> 'temporary'
                  or membership.expires_at is null
                  or membership.expires_at > now()
                )
            )
          )
        )
      )
    union
    select link.parent_id as recipient_id
    from public.parent_athletes link
    where link.coach_id = v_coach_id
      and v_target_type in ('everyone', 'parents')
  ) candidate
  join public.profiles recipient_profile on recipient_profile.id = candidate.recipient_id
  on conflict (broadcast_id, recipient_id) do nothing;

  get diagnostics v_recipient_count = row_count;

  if v_recipient_count = 0 then
    delete from public.coach_broadcasts where id = v_broadcast_id;
    raise exception 'No accounts are linked to that audience yet.';
  end if;

  insert into public.push_notification_queue (
    recipient_id,
    notification_type,
    title,
    body,
    url,
    payload,
    dedupe_key
  )
  select
    recipient.recipient_id,
    'coach_message',
    'Coach message · ' || v_coach_name,
    left(v_message, 180),
    './?push=home',
    jsonb_build_object(
      'view', 'home',
      'broadcast_id', v_broadcast_id,
      'target_label', v_target_label
    ),
    'coach-message:' || v_broadcast_id || ':' || recipient.recipient_id
  from public.coach_broadcast_recipients recipient
  left join public.push_preferences preference on preference.user_id = recipient.recipient_id
  where recipient.broadcast_id = v_broadcast_id
    and coalesce(preference.coach_messages, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = recipient.recipient_id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_push_count = row_count;

  update public.coach_broadcasts
  set recipient_count = v_recipient_count,
      push_count = v_push_count
  where id = v_broadcast_id;

  return jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'recipient_count', v_recipient_count,
    'push_count', v_push_count,
    'target_label', v_target_label
  );
end;
$function$;

revoke all on function public.send_coach_broadcast(text, text, text) from public, anon;
grant execute on function public.send_coach_broadcast(text, text, text) to authenticated;

do $block$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'coach_broadcast_recipients'
    )
  then
    alter publication supabase_realtime add table public.coach_broadcast_recipients;
  end if;
end;
$block$;
