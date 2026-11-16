create or replace function private.prevent_archiving_populated_coach_team()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.status = 'archived'
     and old.status is distinct from new.status
     and exists (
       select 1
       from public.coach_athletes ca
       where ca.team_id = new.id
     ) then
    raise exception 'Move all students to another active team before archiving this team.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_archiving_populated_coach_team on public.coach_teams;
create trigger prevent_archiving_populated_coach_team
before update on public.coach_teams
for each row execute function private.prevent_archiving_populated_coach_team();
