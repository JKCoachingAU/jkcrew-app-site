create or replace function private.jkcrew_post_new_trick_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare rider_name text;
begin
  if new.status <> 'landed' or exists (
    select 1 from public.trick_attempts old
    where old.athlete_id = new.athlete_id
      and lower(old.trick_name) = lower(new.trick_name)
      and old.status = 'landed'
      and old.id <> new.id
  ) then return new;
  end if;
  select display_name into rider_name from public.profiles where id = new.athlete_id;
  insert into public.crew_posts(author_id, body, post_type, metadata)
  values (new.athlete_id, coalesce(rider_name, 'A rider') || ' landed ' || new.trick_name || ' for the first time!', 'announcement',
    jsonb_build_object('event_type','new_trick','author_name',coalesce(rider_name,'Crew rider'),'author_role','athlete','tag','⚡ New trick'));
  return new;
end;
$$;

create or replace function private.jkcrew_post_challenge_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare rider_name text; challenge_title text;
begin
  select display_name into rider_name from public.profiles where id = new.athlete_id;
  select title into challenge_title from public.weekly_challenges where id = new.challenge_id;
  insert into public.crew_posts(author_id, body, post_type, metadata)
  values (new.athlete_id, coalesce(rider_name, 'A rider') || ' completed ' || coalesce(challenge_title, 'the weekly challenge') || '!', 'announcement',
    jsonb_build_object('event_type','challenge_complete','author_name',coalesce(rider_name,'Crew rider'),'author_role','athlete','tag','🏆 Challenge complete'));
  return new;
end;
$$;

revoke all on function private.jkcrew_post_new_trick_event() from public, anon, authenticated;
revoke all on function private.jkcrew_post_challenge_event() from public, anon, authenticated;

drop trigger if exists crew_new_trick_event on public.trick_attempts;
create trigger crew_new_trick_event after insert on public.trick_attempts
for each row execute function private.jkcrew_post_new_trick_event();

drop trigger if exists crew_challenge_event on public.weekly_challenge_completions;
create trigger crew_challenge_event after insert on public.weekly_challenge_completions
for each row execute function private.jkcrew_post_challenge_event();
