-- Support the team's cascading cleanup and scoped worker administration.
create index scoring_announcement_jobs_team_idx on private.scoring_announcement_jobs(team_id);
