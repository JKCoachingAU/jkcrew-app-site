-- Score King of the Park from the best completed session at each venue.
-- Most non-daily awards inherit their venue from the session's daily award row,
-- so first identify eligible sessions by venue and then score every award in it.

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
set search_path = public, private
as $$
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
          when bool_or(split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')) then 1
          else 0
        end
        + coalesce(sum(
          case
            when split_part(award.award_key, ':', 1) in ('dialled', 'one_bang', 'percentage', 'bonus')
              then greatest(award.points, 0)
            else 0
          end
        ), 0)
      )::integer as points,
      session.ended_at
    from eligible_sessions eligible
    join public.training_sessions session
      on session.id = eligible.session_id
     and session.ended_at is not null
    join public.profiles profile
      on profile.id = session.athlete_id
     and profile.role = 'athlete'
    join public.assignment_point_awards award
      on award.session_id = session.id
    group by
      eligible.venue_name,
      session.id,
      session.athlete_id,
      profile.display_name,
      profile.avatar,
      session.ended_at
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
  order by scored.points desc, scored.ended_at asc, scored.display_name asc
  limit 1;
$$;

-- Award rows such as Dialled and One Bangs commonly have a blank venue. Refresh
-- every venue attached to their session whenever one of those rows changes.
create or replace function private.handle_park_king_award_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_venue text;
  v_session_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if nullif(btrim(old.venue), '') is not null then
      perform private.refresh_park_king(old.venue);
    end if;

    v_session_id := old.session_id;
    if v_session_id is not null
      and exists (
        select 1
        from public.training_sessions session
        where session.id = v_session_id
          and session.ended_at is not null
      ) then
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
    if v_session_id is not null
      and exists (
        select 1
        from public.training_sessions session
        where session.id = v_session_id
          and session.ended_at is not null
      ) then
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

  return coalesce(new, old);
end;
$$;

-- Rebuild every permanent venue record using the corrected single-session score.
truncate table public.park_king_snapshots;

insert into public.park_king_snapshots (
  venue_key,
  venue_name,
  athlete_id,
  display_name,
  avatar,
  points,
  updated_at
)
select
  current_king.venue_key,
  current_king.venue_name,
  current_king.athlete_id,
  current_king.display_name,
  current_king.avatar,
  current_king.points,
  now()
from (
  select distinct award.venue
  from public.assignment_point_awards award
  join public.training_sessions session
    on session.id = award.session_id
   and session.ended_at is not null
  where nullif(btrim(award.venue), '') is not null
) venue
cross join lateral private.jkcrew_current_park_king(venue.venue) current_king
on conflict (venue_key) do update
set venue_name = excluded.venue_name,
    athlete_id = excluded.athlete_id,
    display_name = excluded.display_name,
    avatar = excluded.avatar,
    points = excluded.points,
    updated_at = excluded.updated_at;
