do $block$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trick_help_requests'
  ) then
    alter publication supabase_realtime add table public.trick_help_requests;
  end if;
end
$block$;
