-- Temporarily retire XP/levels/badges without deleting earned history or touching
-- trick, daily, challenge, battle, park-crown or UCI points. An administrator can
-- restore progression in a later migration by setting the private flag to true.
-- There is intentionally no client-accessible switch and no retroactive backfill.
create table private.progression_feature_settings (
  singleton boolean primary key default true check (singleton),
  xp_enabled boolean not null default false
);
alter table private.progression_feature_settings enable row level security;
revoke all on private.progression_feature_settings from public, anon, authenticated, service_role;
insert into private.progression_feature_settings (singleton, xp_enabled) values (true, false);

create function private.xp_progression_enabled()
returns boolean language sql stable set search_path = ''
as $$ select coalesce((select xp_enabled from private.progression_feature_settings where singleton), false) $$;
revoke all on function private.xp_progression_enabled() from public, anon, authenticated, service_role;

-- Preserve the old RPC response shape, but report no newly awarded/removed XP.
-- In particular, confirming a Daily list must not manufacture an XP celebration.
create function private.paused_xp_progress(p_athlete_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce((
    select public.xp_progress_json(coalesce(p.xp_total, 0)) || jsonb_build_object(
      'athlete_id', p.id, 'level', coalesce(p.level, 1),
      'level_before', coalesce(p.level, 1), 'level_after', coalesce(p.level, 1),
      'xp_delta', 0, 'xp_awarded', 0, 'xp_removed', 0,
      'leveled_up', false, 'xp_enabled', false,
      'level_badge', public.level_badge(coalesce(p.level, 1))
    ) from public.profiles p where p.id = p_athlete_id
  ), jsonb_build_object('xp_enabled', false, 'xp_delta', 0, 'xp_awarded', 0,
       'xp_removed', 0, 'leveled_up', false));
$$;
revoke all on function private.paused_xp_progress(uuid) from public, anon, authenticated, service_role;

-- Keep each existing function's original body, signature, ACL and score logic.
-- Guard only XP-specific helpers; fail migration rather than patch an unexpected
-- function body. Re-enabling the flag restores the preserved implementation.
do $pause$
declare
  v_signature text;
  v_return text;
  v_definition text;
  v_marker text := E'\nbegin\n';
  v_at integer;
begin
  for v_signature, v_return in select * from (values
    ('public.sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)', 'private.paused_xp_progress(p_athlete_id)'),
    ('public.sync_profile_xp(uuid)', 'private.paused_xp_progress(p_athlete_id)'),
    ('public.ensure_level_badges(uuid)', '0'),
    ('public.sync_achievement_badges(uuid)', '0'),
    ('public.sync_assignment_progress_xp()', 'coalesce(new, old)'),
    ('public.sync_daily_pb_xp()', 'new'),
    ('public.sync_percentage_attempt_xp()', 'coalesce(new, old)')
  ) as guards(signature, return_value)
  loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_at := strpos(v_definition, v_marker);
    if v_at = 0 or strpos(v_definition, 'private.xp_progression_enabled()') > 0 then
      raise exception 'Unexpected XP helper definition: %', v_signature;
    end if;
    execute overlay(v_definition placing
      v_marker || '  if not private.xp_progression_enabled() then return ' || v_return || E'; end if;\n'
      from v_at for length(v_marker));
  end loop;
end;
$pause$;

-- Defence against older clients that update legacy profile fields directly.
-- Unrelated profile edits and normal new-account creation still succeed.
create function private.freeze_profile_progression()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not private.xp_progression_enabled() then
    if tg_op = 'INSERT' then
      new.xp_total := 0; new.level := 1; new.badges := '[]'::jsonb;
    else
      new.xp_total := old.xp_total; new.level := old.level; new.badges := old.badges;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.freeze_profile_progression() from public, anon, authenticated, service_role;
create trigger freeze_profile_progression before insert or update on public.profiles
  for each row execute function private.freeze_profile_progression();

-- Do not let stale clients add, replace or remove earned history. FK cleanup is
-- still allowed: deleting a list/session clears its reference, and an authorised
-- account deletion can cascade normally. These exceptions never change XP or
-- badge ownership/value; this migration itself performs no such deletions.
create function private.freeze_progression_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_old jsonb; v_new jsonb; v_key text;
begin
  if private.xp_progression_enabled() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then return null; end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.profiles p where p.id = old.athlete_id) then return old; end if;
    return null;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach v_key in array case when tg_table_name = 'xp_ledger'
    then array['assignment_id', 'session_id', 'coach_id'] else array['awarded_by'] end
  loop
    if v_new->>v_key is null and v_old->>v_key is not null then
      v_old := jsonb_set(v_old, array[v_key], 'null'::jsonb);
    end if;
  end loop;
  if v_old = to_jsonb(old) then return null; end if;
  new := jsonb_populate_record(old, v_old);
  return new;
end;
$$;
revoke all on function private.freeze_progression_history() from public, anon, authenticated, service_role;
-- Alphabetical order puts the freeze before the existing rider scoring guard.
create trigger freeze_progression_history before insert or update or delete on public.xp_ledger
  for each row execute function private.freeze_progression_history();
create trigger freeze_progression_history before insert or update or delete on public.athlete_badges
  for each row execute function private.freeze_progression_history();

-- No blanket "achievement" suppression: weekly challenges, battles and park
-- crowns share that preference and must keep their points and notifications.
create function private.is_xp_progression_notification(p_type text, p_payload jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(p_type in ('xp_earned', 'xp_awarded', 'xp_bonus', 'level_up', 'level_unlocked',
    'badge_earned', 'badge_unlocked', 'prestige', 'prestige_earned', 'prestige_unlocked')
    or (p_type in ('achievement', 'achievement_earned', 'achievement_unlocked') and (
      p_payload->>'kind' in ('xp', 'level', 'badge', 'prestige')
      or p_payload->>'celebration' in ('xp', 'level', 'badge', 'prestige')
    )), false);
$$;
revoke all on function private.is_xp_progression_notification(text,jsonb) from public, anon, authenticated, service_role;

create function private.suppress_xp_progression_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not private.xp_progression_enabled()
    and private.is_xp_progression_notification(new.notification_type, new.payload) then return null; end if;
  return new;
end;
$$;
revoke all on function private.suppress_xp_progression_notification() from public, anon, authenticated, service_role;
create trigger suppress_xp_progression_notification before insert on public.push_notification_queue
  for each row execute function private.suppress_xp_progression_notification();
create trigger suppress_xp_progression_notification before insert on public.app_notifications
  for each row execute function private.suppress_xp_progression_notification();

-- Cancel undelivered retired-feature messages; retain their historical rows.
update public.push_notification_queue set status = 'skipped', processed_at = clock_timestamp(),
  last_error = 'XP and badge progression is paused'
where status = 'pending' and private.is_xp_progression_notification(notification_type, payload);
update public.app_notifications set archived_at = coalesce(archived_at, clock_timestamp())
where archived_at is null and private.is_xp_progression_notification(notification_type, payload);

-- Rechecking at claim time also covers old failed messages retried after rollout.
-- Keep the worker secret check and the existing recovery-reminder gates intact.
do $claim$
declare
  v_definition text := pg_get_functiondef('public.claim_jkcrew_push_notifications(text,integer)'::regprocedure);
  v_predicate text := 'q.status=''pending'' and q.available_at<=now()';
begin
  if strpos(v_definition, v_predicate) = 0 then raise exception 'Unexpected push claim definition'; end if;
  execute replace(v_definition, v_predicate, v_predicate ||
    ' and (private.xp_progression_enabled() or not private.is_xp_progression_notification(q.notification_type,q.payload))');
end;
$claim$;
