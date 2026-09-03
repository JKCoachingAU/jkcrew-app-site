create or replace function private.jkcrew_post_ranking_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare rider_name text;
begin
  if new.rank_number <> 1 or (tg_op = 'UPDATE' and old.rank_number = 1) then return new; end if;
  select display_name into rider_name from public.profiles where id = new.athlete_id;
  insert into public.crew_posts(author_id, body, post_type, metadata)
  values (new.athlete_id, coalesce(rider_name, 'A rider') || ' just took the #1 spot with ' || new.weekly_points || ' points!', 'announcement',
    jsonb_build_object('event_type','rank_one','author_name',coalesce(rider_name,'Crew rider'),'author_role','athlete','tag','🏆 New crew leader'));
  return new;
end;
$$;

create or replace function private.jkcrew_post_park_king_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.crew_posts(author_id, body, post_type, metadata)
  values (new.athlete_id, new.display_name || ' is the new King of ' || new.venue_name || '!', 'announcement',
    jsonb_build_object('event_type','park_king','author_name',new.display_name,'author_role','athlete','tag','👑 Park champion'));
  return new;
end;
$$;

revoke all on function private.jkcrew_post_ranking_event() from public, anon, authenticated;
revoke all on function private.jkcrew_post_park_king_event() from public, anon, authenticated;

drop trigger if exists crew_ranking_event on public.leaderboard_rank_snapshots;
create trigger crew_ranking_event after insert or update of rank_number on public.leaderboard_rank_snapshots
for each row execute function private.jkcrew_post_ranking_event();

drop trigger if exists crew_park_king_event on public.park_king_events;
create trigger crew_park_king_event after insert on public.park_king_events
for each row execute function private.jkcrew_post_park_king_event();
