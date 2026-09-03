create or replace function private.jkcrew_post_new_trick_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare rider_name text;
begin
  if new.status is distinct from 'landed' or exists (
    select 1 from public.trick_attempts prior_attempt
    where prior_attempt.athlete_id = new.athlete_id
      and lower(prior_attempt.trick_name) = lower(new.trick_name)
      and prior_attempt.status = 'landed'
      and prior_attempt.id <> new.id
  ) then return new;
  end if;
  select display_name into rider_name from public.profiles where id = new.athlete_id;
  insert into public.crew_posts(author_id, body, post_type, metadata)
  values (new.athlete_id, coalesce(rider_name, 'A rider') || ' landed ' || new.trick_name || ' for the first time!', 'announcement',
    jsonb_build_object('event_type','new_trick','author_name',coalesce(rider_name,'Crew rider'),'author_role','athlete','tag','⚡ New trick'));
  return new;
end;
$$;

revoke all on function private.jkcrew_post_new_trick_event() from public, anon, authenticated;
