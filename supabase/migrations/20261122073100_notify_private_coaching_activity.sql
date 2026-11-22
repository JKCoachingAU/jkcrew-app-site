-- Private coaching activity uses the same family of in-app and device alerts
-- as current event notifications. Existing alerts and queued sends are retained.
set local lock_timeout = '5s';

alter table public.push_preferences add column if not exists coach_rank_updates boolean not null default true;

create table private.team_leaderboard_overtake_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.coach_teams(id) on delete cascade,
  score_event text not null,
  passer_id uuid not null,
  overtaken_ids uuid[] not null check (cardinality(overtaken_ids) > 0),
  unique (team_id,score_event,passer_id)
);
alter table private.team_leaderboard_overtake_events enable row level security;
revoke all on private.team_leaderboard_overtake_events from public,anon,authenticated,service_role;

create or replace function private.jkcrew_notification_allowed(p_recipient uuid,p_type text,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  source_id uuid;
  subject_id uuid;
  source_actor uuid;
  source_coach uuid;
  source_event uuid;
  claimed_actor uuid;
begin
  if p_recipient is null or not exists(select 1 from public.profiles where id=p_recipient)
    or not private.jkcrew_actor_approved(p_recipient) or jsonb_typeof(v_payload)<>'object' then return false; end if;
  -- These messages contain no other account's information. All private data
  -- notifications below must resolve a real source row before they are allowed.
  if p_type in ('daily_hype','notification_test','recovery_checkin_reminder') then return true; end if;
  if p_type='uci_rankings_published' then
    return private.jkcrew_uci_rankings_notification_allowed(p_recipient,v_payload);
  elsif p_type='uci_qualification_update' then
    return exists(select 1 from private.uci_schedule_announcements announcement
      where announcement.source_id=v_payload->>'announcement_id'
        and announcement.payload->>'sourceUrl'=v_payload->>'source_url');
  end if;

  if p_type='park_king_changed' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'event_id');
    select event.athlete_id into source_actor from public.park_king_events event where event.id=source_id;
    claimed_actor:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    return source_actor is not null and claimed_actor is not null and claimed_actor=source_actor
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='crew_chat' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'post_id');
    select post.author_id into source_actor from public.crew_posts post where post.id=source_id and post.post_type='chat';
    claimed_actor:=private.jkcrew_notification_uuid(v_payload->>'author_id');
    return source_actor is not null and claimed_actor is not null and claimed_actor=source_actor
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='leaderboard_overtaken' then
    -- Old rank snapshots were global; never reveal them under a new team scope.
    source_actor:=private.jkcrew_notification_uuid(v_payload->>'overtaken_by');
    return coalesce(v_payload->>'tenant_rank_version','')='1' and source_actor is not null
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type in ('weekly_challenge_published','weekly_challenge_completed') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'challenge_id');
    select challenge.created_by into source_actor from public.weekly_challenges challenge where challenge.id=source_id;
    if source_actor is null or not private.jkcrew_profiles_share_team(p_recipient,source_actor) then return false; end if;
    if p_type='weekly_challenge_published' then return true; end if;
    subject_id:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    if subject_id is null then subject_id:=p_recipient; end if;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and exists(select 1 from public.weekly_challenge_completions completion
        where completion.challenge_id=source_id and completion.athlete_id=subject_id);
  elsif p_type in ('rider_battle_request','rider_battle_started','rider_battle_result','rider_battle_declined','rider_battle_deleted') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'battle_id');
    select coalesce(battle.created_by,battle.challenger_id) into source_actor from public.weekly_rider_battles battle where battle.id=source_id;
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor)
      and exists(select 1 from public.weekly_rider_battle_participants participant where participant.battle_id=source_id
        and private.jkcrew_notification_subject_allowed(p_recipient,participant.athlete_id))
      and not exists(select 1 from public.weekly_rider_battle_participants participant where participant.battle_id=source_id
        and not private.jkcrew_profiles_share_team(p_recipient,participant.athlete_id));
  elsif p_type='coach_leaderboard_overtake' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'rank_event_id');
    return exists (
      select 1
      from private.team_leaderboard_overtake_events event
      join private.coach_team_memberships member on member.team_id=event.team_id
      join public.coach_teams team on team.id=event.team_id and team.status='active'
      join public.profiles recipient on recipient.id=member.coach_id
      where event.id=source_id and member.coach_id=p_recipient and member.status='active'
        and recipient.role::text in ('coach','admin')
        and private.jkcrew_profile_team_id(event.passer_id)=event.team_id
        and not exists (
          select 1 from unnest(event.overtaken_ids) as overtaken(rider_id)
          where private.jkcrew_profile_team_id(overtaken.rider_id) is distinct from event.team_id
        )
    );
  elsif p_type in ('event_reminder','event_updated') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'event_id');
    select coalesce(item.created_by,item.owner_id) into source_actor from public.dashboard_items item where item.id=source_id and item.item_type='event';
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='event_run_planned' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'run_plan_id');
    select plan.athlete_id,plan.coach_id,plan.contest_item_id into subject_id,source_coach,source_event
      from public.run_plans plan where plan.id=source_id;
    if source_event is distinct from private.jkcrew_notification_uuid(v_payload->>'event_id')
      or subject_id is distinct from private.jkcrew_notification_uuid(v_payload->>'athlete_id') then return false; end if;
    select coalesce(item.created_by,item.owner_id) into source_actor from public.dashboard_items item where item.id=source_event;
    return p_recipient=source_coach and private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type in ('rider_run_saved','coach_run_saved') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'run_plan_id');
    select plan.athlete_id,plan.coach_id,plan.created_by,plan.contest_item_id
      into subject_id,source_coach,source_actor,source_event
      from public.run_plans plan where plan.id=source_id and plan.archived_at is null;
    if source_event is distinct from private.jkcrew_notification_uuid(v_payload->>'event_id')
      or subject_id is distinct from private.jkcrew_notification_uuid(v_payload->>'athlete_id') then return false; end if;
    if not (
      private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and private.jkcrew_actor_approved(source_coach)
      and private.jkcrew_profiles_share_team(source_coach,subject_id)
      and exists(select 1 from public.coach_athletes link where link.coach_id=source_coach and link.athlete_id=subject_id)
    ) then return false; end if;
    if source_event is not null and not exists (
      select 1 from public.dashboard_items item
      where item.id=source_event and item.item_type='event'
        and private.jkcrew_profiles_share_team(p_recipient,item.owner_id)
        and (item.created_by is null or private.jkcrew_profiles_share_team(p_recipient,item.created_by))
    ) then return false; end if;
    return case p_type when 'rider_run_saved' then p_recipient=source_coach and source_actor=subject_id
      else p_recipient=subject_id and source_actor=source_coach end;
  elsif p_type in ('video_review_requested','video_review_returned') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'request_id');
    select request.athlete_id,request.coach_id into subject_id,source_coach from public.trick_help_requests request where request.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and private.jkcrew_actor_approved(source_coach)
      and private.jkcrew_profiles_share_team(source_coach,subject_id)
      and p_recipient=case p_type when 'video_review_requested' then source_coach else subject_id end;
  elsif p_type in ('list_request_sent','list_request_approved','list_request_declined') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'proposal_id');
    select proposal.athlete_id,proposal.coach_id into subject_id,source_coach from public.rider_sheet_proposals proposal where proposal.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and private.jkcrew_actor_approved(source_coach)
      and private.jkcrew_profiles_share_team(source_coach,subject_id)
      and p_recipient=case p_type when 'list_request_sent' then source_coach else subject_id end;
  elsif p_type in ('live_run_invite','live_run_response') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'live_run_id');
    select live.athlete_id,live.coach_id into subject_id,source_coach from public.run_live_sessions live where live.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_coach is not null and private.jkcrew_profiles_share_team(p_recipient,source_coach);
  elsif p_type='coach_message' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'broadcast_id');
    select broadcast.coach_id into source_actor from public.coach_broadcasts broadcast where broadcast.id=source_id;
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor)
      and exists(select 1 from public.coach_broadcast_recipients recipient where recipient.broadcast_id=source_id and recipient.recipient_id=p_recipient);
  elsif p_type='sheet_scheduled' then
    return exists(select 1 from public.weekly_assignment_plans plan
      where plan.athlete_id=p_recipient and plan.target_week_start::text=v_payload->>'week_start'
        and private.jkcrew_profiles_share_team(p_recipient,plan.coach_id));
  elsif p_type in ('daily_list_completed','trick_completed','parent_weekly_summary','parent_engagement_checkin') then
    subject_id:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    if v_payload ? 'assignment_id' and v_payload->>'assignment_id' is not null then
      source_id:=private.jkcrew_notification_uuid(v_payload->>'assignment_id');
      select assignment.athlete_id into source_actor from public.weekly_trick_assignments assignment where assignment.id=source_id;
      if source_actor is not null and subject_id is distinct from source_actor then return false; end if;
    end if;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id);
  end if;
  return false;
end;
$$;

create or replace function private.emit_jkcrew_notification(
  p_recipient_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_view text,
  p_payload jsonb,
  p_source_key text,
  p_preference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preference public.push_preferences;
  v_push_allowed boolean := true;
  v_available_at timestamptz := now();
  v_timezone text := 'Australia/Brisbane';
  v_local_now timestamp;
  v_quiet_end_local timestamp;
begin
  if p_recipient_id is null or nullif(btrim(coalesce(p_source_key, '')), '') is null then return; end if;

  insert into public.app_notifications (
    recipient_id, notification_type, title, body, view, payload, source_key
  ) values (
    p_recipient_id,
    coalesce(nullif(btrim(p_notification_type), ''), 'update'),
    coalesce(nullif(btrim(p_title), ''), 'JKCREW update'),
    coalesce(p_body, ''),
    coalesce(nullif(btrim(p_view), ''), 'home'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('view', coalesce(nullif(btrim(p_view), ''), 'home')),
    p_source_key
  ) on conflict (source_key) do nothing;

  select preference.* into v_preference
  from public.push_preferences preference
  where preference.user_id = p_recipient_id;

  v_push_allowed := case p_preference
    when 'battle' then coalesce(v_preference.battle_updates, true)
    when 'challenge' then coalesce(v_preference.challenge_updates, true)
    when 'event' then coalesce(v_preference.event_updates, true)
    when 'sheet' then coalesce(v_preference.sheet_updates, true)
    when 'list' then coalesce(v_preference.list_requests, true)
    when 'coach_rank' then coalesce(v_preference.coach_rank_updates, true)
    when 'coaching' then coalesce(v_preference.coaching_updates, true)
    when 'achievement' then coalesce(v_preference.achievement_updates, true)
    else true
  end;

  if not v_push_allowed or not exists (
    select 1 from public.push_subscriptions subscription
    where subscription.user_id = p_recipient_id and subscription.enabled
  ) then return; end if;

  if coalesce(v_preference.quiet_hours_enabled, false) then
    select coalesce(public.jkcrew_country_timezone(profile.country_code), 'Australia/Brisbane')
      into v_timezone
    from public.profiles profile where profile.id = p_recipient_id;
    v_local_now := timezone(v_timezone, now());
    if v_preference.quiet_hours_start < v_preference.quiet_hours_end
      and v_local_now::time >= v_preference.quiet_hours_start
      and v_local_now::time < v_preference.quiet_hours_end then
      v_quiet_end_local := v_local_now::date + v_preference.quiet_hours_end;
    elsif v_preference.quiet_hours_start > v_preference.quiet_hours_end
      and (v_local_now::time >= v_preference.quiet_hours_start or v_local_now::time < v_preference.quiet_hours_end) then
      v_quiet_end_local := case
        when v_local_now::time < v_preference.quiet_hours_end then v_local_now::date + v_preference.quiet_hours_end
        else (v_local_now::date + 1) + v_preference.quiet_hours_end
      end;
    end if;
    if v_quiet_end_local is not null then v_available_at := v_quiet_end_local at time zone v_timezone; end if;
  end if;

  insert into public.push_notification_queue (
    recipient_id, notification_type, title, body, url, payload, dedupe_key, available_at
  ) values (
    p_recipient_id, p_notification_type, p_title, coalesce(p_body, ''),
    './?push=' || coalesce(nullif(btrim(p_view), ''), 'home'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('view', coalesce(nullif(btrim(p_view), ''), 'home')),
    p_source_key, v_available_at
  ) on conflict (dedupe_key) do nothing;
end;
$function$;

create or replace function private.queue_jkcrew_list_request_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if auth.uid() is distinct from new.athlete_id or new.status is distinct from 'pending' then return new; end if;
    perform private.emit_jkcrew_notification(
      new.coach_id,'list_request_sent','New list request',
      'A rider sent a weekly list for your approval.','command',
      jsonb_build_object('proposal_id',new.id,'athlete_id',new.athlete_id),
      'list-request-sent:'||new.id::text||':'||new.coach_id::text,'list'
    );
  elsif new.status='accepted' and old.status is distinct from new.status
        and private.jkcrew_is_team_coach(new.coach_id) then
    perform private.emit_jkcrew_notification(
      new.athlete_id,'list_request_approved','Your lists were approved',
      'Your coach approved your weekly list. Open JKCREW to see it.','home',
      jsonb_build_object('proposal_id',new.id),
      'list-request-approved:'||new.id::text||':'||new.athlete_id::text,'list'
    );
  end if;
  return new;
exception when others then
  raise warning 'JKCREW list notification skipped (%).', sqlstate;
  return new;
end;
$$;

create or replace function private.queue_jkcrew_video_coaching_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_has_feedback boolean;
  v_feedback_changed boolean;
begin
  if tg_op='INSERT' then
    if auth.uid() is distinct from new.athlete_id then return new; end if;
    perform private.emit_jkcrew_notification(
      new.coach_id,'video_review_requested','New trick video to review',
      'A rider sent you a private trick video for feedback.','videoReviews',
      jsonb_build_object('request_id',new.id,'athlete_id',new.athlete_id),
      'video-review-requested:'||new.id::text||':'||new.coach_id::text,'coaching'
    );
    return new;
  end if;

  if not private.jkcrew_is_team_coach(new.coach_id)
      or coalesce(new.status,'') not in ('replied','reviewed') then return new; end if;
  v_has_feedback:=nullif(btrim(coalesce(new.coach_comment,'')),'') is not null
    or nullif(btrim(coalesce(new.coach_video_storage_path,'')),'') is not null;
  v_feedback_changed:=(old.coach_comment is distinct from new.coach_comment
    or old.coach_video_storage_path is distinct from new.coach_video_storage_path);
  -- The first completed review counts even without a written reply. Archiving
  -- an already returned review should not send the same feedback again.
  if coalesce(old.status,'') not in ('replied','reviewed') or (v_has_feedback and v_feedback_changed) then
    perform private.emit_jkcrew_notification(
      new.athlete_id,'video_review_returned','Your trick review is ready',
      case when v_has_feedback then 'Open JKCREW to see your coach’s feedback.'
        else 'Your coach marked your trick video as reviewed.' end,'coaching',
      jsonb_build_object('request_id',new.id),
      'video-review-returned:'||new.id::text||':'||
        md5(coalesce(new.coach_comment,'')||coalesce(new.coach_video_storage_path,'')||new.status),
      'coaching'
    );
  end if;
  return new;
exception when others then
  raise warning 'JKCREW trick review notification skipped (%).', sqlstate;
  return new;
end;
$$;

create or replace function private.notify_event_run_saved()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_payload jsonb;
begin
  if auth.uid() is distinct from new.created_by or new.archived_at is not null
    or not private.jkcrew_actor_approved(new.coach_id)
    or not private.jkcrew_profiles_share_team(new.coach_id,new.athlete_id)
    or not exists (
      select 1 from public.coach_athletes link
      where link.coach_id=new.coach_id and link.athlete_id=new.athlete_id
    ) then return new; end if;

  v_payload:=jsonb_build_object('run_plan_id',new.id,'athlete_id',new.athlete_id,'event_id',new.contest_item_id);
  if new.created_by=new.athlete_id then
    if new.contest_item_id is not null then
      -- Keep the event-specific kind and original source key for existing flows.
      perform private.emit_jkcrew_notification(
        new.coach_id,'event_run_planned','New event run to review',
        'A rider saved a private run for an upcoming event.','contests',v_payload,
        'event-run:'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text,'event'
      );
    else
      perform private.emit_jkcrew_notification(
        new.coach_id,'rider_run_saved','New run from a rider',
        'A rider saved a run you can view in Events & Runs.','contests',v_payload,
        'rider-run-saved:'||new.id::text||':'||new.coach_id::text,'event'
      );
    end if;
  elsif new.created_by=new.coach_id and private.jkcrew_is_team_coach(new.coach_id) then
    perform private.emit_jkcrew_notification(
      new.athlete_id,'coach_run_saved','Your coach saved a run',
      'Open Events & Runs to view your new run.','contests',v_payload,
      'coach-run-saved:'||new.id::text||':'||new.athlete_id::text,'event'
    );
  end if;
  return new;
exception when others then
  raise warning 'JKCREW new run notification skipped (%).', sqlstate;
  return new;
end;
$$;

create or replace trigger event_run_saved_notification
  after insert on public.run_plans
  for each row execute function private.notify_event_run_saved();

create or replace function private.refresh_team_push_snapshots_now(p_team uuid,p_changed uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare
  ranks jsonb;
  overtakes jsonb;
  rank_event record;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jkcrew-push-rank-team:'||p_team::text,0));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into ranks from private.jkcrew_push_rankings_for_team(p_team) r;
  select coalesce(jsonb_agg(jsonb_build_object(
    'athlete_id',r.athlete_id,'rank_number',r.rank_number,'weekly_points',r.weekly_points,
    'passer_id',passer.athlete_id,'passer_name',passer.display_name
  )),'[]') into overtakes
  from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  join public.leaderboard_rank_snapshots old on old.athlete_id=r.athlete_id and old.week_start=r.week_start
  cross join lateral (
    select peer.* from jsonb_to_recordset(ranks) as peer(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
    join public.leaderboard_rank_snapshots prior on prior.athlete_id=peer.athlete_id and prior.week_start=peer.week_start
    where peer.athlete_id<>r.athlete_id and peer.week_start=r.week_start and peer.rank_number<r.rank_number
      and prior.rank_number>=old.rank_number and peer.weekly_points>prior.weekly_points
      and peer.weekly_points>r.weekly_points and r.weekly_points>=old.weekly_points
      and (p_changed is null or peer.athlete_id=p_changed)
    order by peer.rank_number,peer.athlete_id limit 1
  ) passer
  where r.weekly_started and r.rank_number>old.rank_number;

  insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
  select r.athlete_id,'leaderboard_overtaken','You were overtaken',
    case when p_changed is not null then r.passer_name||' moved ahead of you. ' else 'The leaderboard changed. ' end||
      'You are now #'||r.rank_number||' with '||r.weekly_points||' points.',
    './?push=board',jsonb_build_object('view','board','tenant_rank_version',1,'rank',r.rank_number,
      'weekly_points',r.weekly_points,'overtaken_by',r.passer_id),
    'leaderboard-overtaken:'||p_event||':'||r.athlete_id
  from jsonb_to_recordset(overtakes) as r(athlete_id uuid,rank_number bigint,weekly_points bigint,passer_id uuid,passer_name text)
  left join public.push_preferences preference on preference.user_id=r.athlete_id
  where coalesce(preference.leaderboard_overtaken,true)
    and exists(select 1 from public.push_subscriptions subscription where subscription.user_id=r.athlete_id and subscription.enabled)
  on conflict(dedupe_key) do nothing;

  -- The same verified crossings drive coach alerts independent of each rider's
  -- device, preference or subscription. Keep one source per scoring event and
  -- passer, even when the passer moves ahead of more than one rider.
  for rank_event in
    insert into private.team_leaderboard_overtake_events(team_id,score_event,passer_id,overtaken_ids)
    select p_team,p_event,r.passer_id,array_agg(r.athlete_id order by r.athlete_id)
    from jsonb_to_recordset(overtakes) as r(athlete_id uuid,passer_id uuid)
    group by r.passer_id
    on conflict(team_id,score_event,passer_id) do nothing
    returning id, team_id
  loop
    perform private.emit_jkcrew_notification(
      member.coach_id,'coach_leaderboard_overtake','Your team leaderboard changed',
      'A rider on your team moved ahead on the weekly leaderboard.','board',
      jsonb_build_object('rank_event_id',rank_event.id),
      'coach-leaderboard-overtake:'||rank_event.id::text||':'||member.coach_id::text,'coach_rank'
    )
    from private.coach_team_memberships member
    join public.profiles coach on coach.id=member.coach_id
    where member.team_id=rank_event.team_id and member.status='active'
      and coach.role::text in ('coach','admin') and private.jkcrew_actor_approved(member.coach_id);
  end loop;
  insert into public.leaderboard_rank_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
  select r.athlete_id,r.week_start,r.rank_number,r.weekly_points,r.weekly_started,now()
  from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  order by r.athlete_id on conflict(athlete_id) do update set week_start=excluded.week_start,rank_number=excluded.rank_number,
    weekly_points=excluded.weekly_points,weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
  delete from public.leaderboard_rank_snapshots s where private.jkcrew_profile_team_id(s.athlete_id)=p_team
    and not exists(select 1 from jsonb_to_recordset(ranks) as r(athlete_id uuid) where r.athlete_id=s.athlete_id);
end;
$$;

revoke all on function private.queue_jkcrew_list_request_push(),
  private.queue_jkcrew_video_coaching_push(),private.notify_event_run_saved(),
  private.refresh_team_push_snapshots_now(uuid,uuid,text),
  private.emit_jkcrew_notification(uuid,text,text,text,text,jsonb,text,text)
from public,anon,authenticated,service_role;

select private.install_uci_rankings_notification_jobs();
