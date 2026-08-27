create or replace function private.queue_jkcrew_video_coaching_push()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_athlete_name text;
  v_reply_changed boolean := false;
begin
  select profile.display_name into v_athlete_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  if tg_op = 'INSERT' then
    insert into public.push_notification_queue (
      recipient_id, notification_type, title, body, url, payload, dedupe_key
    )
    select
      new.coach_id,
      'video_review_requested',
      'New trick video to review 🎥',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A rider') || ' sent a private trick video for feedback.',
      './?push=videoReviews',
      jsonb_build_object('view', 'videoReviews', 'request_id', new.id, 'athlete_id', new.athlete_id),
      'video-review-requested:' || new.id || ':' || new.coach_id
    where exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = new.coach_id and subscription.enabled
    )
    on conflict (dedupe_key) do nothing;
  else
    v_reply_changed :=
      old.coach_comment is distinct from new.coach_comment
      or old.coach_video_storage_path is distinct from new.coach_video_storage_path
      or (old.status is distinct from new.status and new.status in ('replied', 'reviewed'));

    if v_reply_changed and (
      nullif(btrim(coalesce(new.coach_comment, '')), '') is not null
      or nullif(btrim(coalesce(new.coach_video_storage_path, '')), '') is not null
      or new.status in ('replied', 'reviewed')
    ) then
      insert into public.push_notification_queue (
        recipient_id, notification_type, title, body, url, payload, dedupe_key
      )
      select
        new.athlete_id,
        'video_review_returned',
        'Coach JK replied to your video 🔥',
        'Your private trick review is ready. Open JKCREW to watch the feedback.',
        './?push=coaching',
        jsonb_build_object('view', 'coaching', 'request_id', new.id),
        'video-review-returned:' || new.id || ':' || md5(coalesce(new.coach_comment, '') || coalesce(new.coach_video_storage_path, '') || coalesce(new.status, ''))
      where exists (
        select 1 from public.push_subscriptions subscription
        where subscription.user_id = new.athlete_id and subscription.enabled
      )
      on conflict (dedupe_key) do nothing;
    end if;
  end if;

  return new;
exception when others then
  raise warning 'JKCREW video coaching push skipped: %', sqlerrm;
  return new;
end;
$function$;

revoke all on function private.queue_jkcrew_video_coaching_push() from public, anon, authenticated;

drop trigger if exists trick_help_request_push on public.trick_help_requests;
create trigger trick_help_request_push
  after insert or update of status, coach_comment, coach_video_storage_path on public.trick_help_requests
  for each row execute function private.queue_jkcrew_video_coaching_push();
