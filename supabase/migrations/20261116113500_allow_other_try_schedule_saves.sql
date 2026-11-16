do $$
declare ddl text;
begin
  select pg_get_functiondef('public.save_weekly_assignments(uuid,date,jsonb,jsonb)'::regprocedure) into ddl;
  ddl := replace(ddl, '''foam_pit'', ''bonus'', ''lines'', ''trick_links''', '''foam_pit'', ''bonus'', ''lines'', ''trick_links'', ''other''');
  execute ddl;
end;
$$;

notify pgrst, 'reload schema';
