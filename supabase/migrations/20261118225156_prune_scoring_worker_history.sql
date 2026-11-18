-- The five-second announcement worker produces about 17,280 run receipts/day.
-- Retain seven days only for this new worker and its own hourly cleanup job.
-- Each call deletes at most 5,000 finished receipts; unrelated cron history and
-- in-progress runs are preserved. No scoring records or queue jobs are touched.
set local lock_timeout='5s';

create function private.prune_scoring_worker_history()
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if auth.uid() is not null then
    raise exception 'Server worker required' using errcode='42501';
  end if;
  with expired as materialized (
    select detail.runid
    from cron.job_run_details detail
    join cron.job job on job.jobid=detail.jobid
    where job.jobname in ('jkcrew-scoring-announcements','jkcrew-prune-scoring-worker-history')
      and job.username=current_user
      and detail.end_time < now()-interval '7 days'
    order by detail.end_time,detail.runid
    limit 5000
    for update of detail skip locked
  )
  delete from cron.job_run_details detail using expired
  where detail.runid=expired.runid;
  get diagnostics removed=row_count;
  return removed;
end;
$$;
revoke all on function private.prune_scoring_worker_history() from public,anon,authenticated,service_role;

-- Hourly capacity (120,000 receipts/day) exceeds the five-second worker rate.
select cron.schedule('jkcrew-prune-scoring-worker-history','17 * * * *','select private.prune_scoring_worker_history()');
