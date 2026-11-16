-- Allow the single-list editor to save the Other Things to Try category.
do $$
declare
  ddl text;
begin
  select pg_get_functiondef('public.save_weekly_assignment_list(uuid,date,text,text,jsonb)'::regprocedure)
    into ddl;
  ddl := replace(
    ddl,
    '''daily'', ''dialled'', ''one_bang'', ''percentage'', ''foam_pit'', ''bonus'', ''lines'', ''trick_links''',
    '''daily'', ''dialled'', ''one_bang'', ''percentage'', ''foam_pit'', ''bonus'', ''lines'', ''trick_links'', ''other'''
  );
  execute ddl;
end;
$$;

notify pgrst, 'reload schema';
