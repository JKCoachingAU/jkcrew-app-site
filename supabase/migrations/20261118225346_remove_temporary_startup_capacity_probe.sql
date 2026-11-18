-- Fifteen isolated synthetic riders were exercised through the live Auth and
-- Data APIs, then deleted. Remove every temporary service-only fixture entry.
drop function public.startup_capacity_probe_fixture(text,text,uuid,uuid[]);
drop table private.startup_capacity_probe_runs;
notify pgrst,'reload schema';
