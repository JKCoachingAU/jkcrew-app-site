-- Ringing/connection polling needs session metadata, never the draft/course photo.
-- Extend the existing authenticated get branch so authorization, expiry, device
-- binding and all older actions keep exactly their existing behavior. Check the
-- anchors before editing: refuse an unexpected upstream implementation rather
-- than replace an unrelated branch or silently weaken a permission check.
do $migration$
declare
  definition text := pg_get_functiondef(
    'private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint)'::regprocedure);
  get_anchor text := E'  if p_action=''get'' then\n';
  draft_anchor text := E'    select draft into d from private.run_live_drafts where session_id=s.id\n      and (s.invitation_status=''accepted'' or s.created_by=actor);';
begin
  if (length(definition)-length(replace(definition,get_anchor,'')))/length(get_anchor) <> 1
    or (length(definition)-length(replace(definition,draft_anchor,'')))/length(draft_anchor) <> 1 then
    raise exception 'Live call status migration needs review: expected get/authorization branch changed.';
  end if;
  definition := replace(definition,get_anchor,E'  if p_action in (''get'',''status'') then\n');
  definition := replace(definition,draft_anchor,
    E'    -- Metadata polls must not read/decode the private draft or its course image.\n'
    || E'    if p_action=''status'' then return jsonb_build_object(''session'',to_jsonb(s)); end if;\n'
    || draft_anchor);
  execute definition;
end;
$migration$;

-- CREATE OR REPLACE above preserves ownership, SECURITY DEFINER/search_path and
-- existing ACLs. Reassert the established explicit-auth API grants defensively;
-- the public entry remains SECURITY INVOKER over the private implementation.
revoke all on function private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) from public,anon;
grant execute on function private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) to authenticated;
revoke all on function public.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) from public,anon;
grant execute on function public.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) to authenticated;
