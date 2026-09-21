begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Opt-in wire format only. Existing RPCs, stored drafts, receipts, permissions
-- and old installed clients retain their original behavior. The image is sent
-- once per participant, then again only if its SHA-256 identity changes.
create function private.compact_live_run_result(p_result jsonb, p_image_key text)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare image_key text;
begin
  if jsonb_typeof(p_result->'draft') is distinct from 'object'
    or not (p_result->'draft' ? 'imageDataUrl') then return p_result; end if;
  image_key := encode(sha256(convert_to(coalesce(p_result#>>'{draft,imageDataUrl}', ''), 'UTF8')), 'hex');
  if image_key = p_image_key then
    return (p_result #- '{draft,imageDataUrl}') || jsonb_build_object('image_key', image_key, 'image_omitted', true);
  end if;
  return p_result || jsonb_build_object('image_key', image_key, 'image_omitted', false);
end;
$$;
revoke all on function private.compact_live_run_result(jsonb,text) from public,anon;
grant execute on function private.compact_live_run_result(jsonb,text) to authenticated;

-- All access/participant/device checks, locking, operation receipts and merge
-- handling run in the established function before its result is compacted.
create function public.live_run_edit_compact(
  p_session_id uuid, p_client_id uuid, p_request_id uuid, p_version bigint,
  p_ops jsonb, p_image_key text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.compact_live_run_result(
    public.live_run_edit(p_session_id,p_client_id,p_request_id,p_version,p_ops), p_image_key);
$$;
revoke all on function public.live_run_edit_compact(uuid,uuid,uuid,bigint,jsonb,text) from public,anon;
grant execute on function public.live_run_edit_compact(uuid,uuid,uuid,bigint,jsonb,text) to authenticated;

create function public.live_run_action_compact(
  p_action text, p_session_id uuid default null, p_client_id uuid default null,
  p_version bigint default null, p_patch jsonb default '{}'::jsonb,
  p_athlete_id uuid default null, p_coach_id uuid default null, p_image_key text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.compact_live_run_result(
    public.live_run_action(p_action,p_session_id,p_client_id,p_version,p_patch,p_athlete_id,p_coach_id), p_image_key);
$$;
revoke all on function public.live_run_action_compact(text,uuid,uuid,bigint,jsonb,uuid,uuid,text) from public,anon;
grant execute on function public.live_run_action_compact(text,uuid,uuid,bigint,jsonb,uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
