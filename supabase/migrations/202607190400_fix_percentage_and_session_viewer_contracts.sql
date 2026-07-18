-- Keep the venue context while matching the JSON contract returned by the
-- canonical percentage-attempt function.
drop function if exists public.set_percentage_attempt_at_venue(uuid, integer, boolean, text);

create function public.set_percentage_attempt_at_venue(
  p_assignment_id uuid,
  p_attempt_number integer,
  p_landed boolean default null,
  p_venue text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  perform set_config('jkcrew.venue', coalesce(btrim(p_venue), ''), true);
  return public.set_percentage_attempt(p_assignment_id, p_attempt_number, p_landed);
end;
$function$;

revoke all on function public.set_percentage_attempt_at_venue(uuid, integer, boolean, text) from public, anon;
grant execute on function public.set_percentage_attempt_at_venue(uuid, integer, boolean, text) to authenticated;
