-- The rider can edit their own run whether it was created by them or their coach.
alter policy run_plans_athlete_own_update on public.run_plans
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));

-- Shared content editing must not allow reassignment of the private run.
create or replace function private.guard_saved_run_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null and row(new.id,new.athlete_id,new.coach_id,new.created_by)
    is distinct from row(old.id,old.athlete_id,old.coach_id,old.created_by) then
    raise exception 'A saved run stays with its original rider and coach.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_saved_run_identity() from public,anon,authenticated;
create trigger guard_saved_run_identity before update on public.run_plans
  for each row execute function private.guard_saved_run_identity();

create or replace function public.save_shared_run_edits(p_run_id uuid, p_expected_updated_at timestamptz, p_content jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.run_plans;
begin
  if auth.uid() is null then raise exception 'Sign in to edit this run.'; end if;
  if p_expected_updated_at is null then raise exception 'Reopen the saved run before editing.'; end if;
  if jsonb_typeof(p_content->'points') is distinct from 'array' or btrim(coalesce(p_content->>'image_data_url','')) = '' then
    raise exception 'Keep a park photo and valid route before saving.';
  end if;
  update public.run_plans set
    title=btrim(p_content->>'title'),venue=coalesce(p_content->>'venue',''),
    plan_type=coalesce(p_content->>'plan_type','training'),notes=coalesce(p_content->>'notes',''),
    points=p_content->'points',image_data_url=p_content->>'image_data_url',
    contest_item_id=nullif(p_content->>'contest_item_id','')::uuid
    where id=p_run_id and updated_at=p_expected_updated_at
    returning * into r;
  if not found then raise exception 'This run changed or is no longer available. Your edits are still here. Reopen the latest run, or use Copy to keep your version.'; end if;
  return jsonb_build_object('id',r.id,'updated_at',r.updated_at);
end;
$$;
revoke all on function public.save_shared_run_edits(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.save_shared_run_edits(uuid,timestamptz,jsonb) to authenticated;
