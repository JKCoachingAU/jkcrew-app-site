-- King of the Park is the best complete score from one training session at a
-- venue. Include active sessions so the crown updates during a lesson, include
-- Lines, and recover a detached Daily completion from the same rider/venue/day.

create or replace function public.record_line_action_at_venue(
  p_assignment_id uuid,
  p_action text default 'landed',
  p_venue text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  perform set_config('jkcrew.venue', coalesce(btrim(p_venue), ''), true);
  return public.record_line_action(p_assignment_id, p_action);
end;
$function$;

revoke all on function public.record_line_action_at_venue(uuid, text, text) from public, anon;
grant execute on function public.record_line_action_at_venue(uuid, text, text) to authenticated;

create or replace function private.jkcrew_current_park_king(p_venue text)
returns table (
  venue_key text,
  venue_name text,
  athlete_id uuid,
  display_name text,
  avatar jsonb,
  points integer
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  with requested as (
    select private.jkcrew_venue_key(p_venue) as venue_key
  ),
  eligible_sessions as (
    select
      award.session_id,
      max(btrim(award.venue)) as venue_name
    from public.assignment_point_awards award
    cross join requested
    where award.session_id is not null
      and nullif(btrim(award.venue), '') is not null
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
    group by award.session_id
  ),
  scored_sessions as (
    select
      private.jkcrew_venue_key(eligible.venue_name) as venue_key,
      eligible.venue_name,
      session.athlete_id,
      coalesce(nullif(btrim(profile.display_name), ''), 'Rider') as display_name,
      coalesce(profile.avatar, '{}'::jsonb) as avatar,
      (
        case
          when bool_or(split_part(award.award_key, ':', 1) in (
            'daily', 'daily-complete', 'daily-under-20'
          ))
          or exists (
            select 1
            from public.assignment_point_awards daily_award
            where daily_award.athlete_id = session.athlete_id
              and private.jkcrew_venue_key(daily_award.venue) = private.jkcrew_venue_key(eligible.venue_name)
              and split_part(daily_award.award_key, ':', 1) in (
                'daily', 'daily-complete', 'daily-under-20'
              )
              and (
                daily_award.created_at at time zone public.jkcrew_country_timezone(profile.country_code)
              )::date = (
                session.started_at at time zone public.jkcrew_country_timezone(profile.country_code)
              )::date
          ) then 1
          else 0
        end
        + coalesce(sum(
          case
            when split_part(award.award_key, ':', 1) in (
              'dialled', 'one_bang', 'percentage', 'lines', 'bonus'
            ) then greatest(award.points, 0)
            else 0
          end
        ), 0)
      )::integer as points,
      max(award.created_at) as achieved_at
    from eligible_sessions eligible
    join public.training_sessions session
      on session.id = eligible.session_id
    join public.profiles profile
      on profile.id = session.athlete_id
     and profile.role = 'athlete'
    join public.assignment_point_awards award
      on award.session_id = session.id
    group by
      eligible.venue_name,
      session.id,
      session.athlete_id,
      session.started_at,
      profile.display_name,
      profile.avatar,
      profile.country_code
  )
  select
    scored.venue_key,
    scored.venue_name,
    scored.athlete_id,
    scored.display_name,
    scored.avatar,
    scored.points
  from scored_sessions scored
  where scored.points > 0
  order by
    scored.points desc,
    scored.achieved_at asc,
    scored.display_name asc,
    scored.athlete_id asc
  limit 1;
$function$;

revoke all on function private.jkcrew_current_park_king(text) from public, anon, authenticated;

-- Refresh the venue attached to every award in the session, even before the
-- rider or coach ends it. This is especially important for Lines, whose older
-- award rows may not contain their own venue.
create or replace function private.handle_park_king_award_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_venue text;
  v_session_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if nullif(btrim(old.venue), '') is not null then
      perform private.refresh_park_king(old.venue);
    end if;

    v_session_id := old.session_id;
    if v_session_id is not null then
      for v_venue in
        select distinct award.venue
        from public.assignment_point_awards award
        where award.session_id = v_session_id
          and nullif(btrim(award.venue), '') is not null
      loop
        perform private.refresh_park_king(v_venue);
      end loop;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if nullif(btrim(new.venue), '') is not null then
      perform private.refresh_park_king(new.venue);
    end if;

    v_session_id := new.session_id;
    if v_session_id is not null then
      for v_venue in
        select distinct award.venue
        from public.assignment_point_awards award
        where award.session_id = v_session_id
          and nullif(btrim(award.venue), '') is not null
      loop
        perform private.refresh_park_king(v_venue);
      end loop;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.handle_park_king_award_change() from public, anon, authenticated;

-- Recalculate every known venue with the corrected shared rule. The refresh
-- function records a crown event only where the winning rider actually changes.
do $block$
declare
  v_venue text;
begin
  for v_venue in
    select distinct btrim(award.venue)
    from public.assignment_point_awards award
    where nullif(btrim(award.venue), '') is not null
  loop
    perform private.refresh_park_king(v_venue);
  end loop;
end;
$block$;
