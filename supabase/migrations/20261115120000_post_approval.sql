-- Approval for a new shop's first three posts (lib/safe-automation.ts).
--
-- scheduled_posts.status gains a value, 'awaiting_approval', which the publisher
-- never picks up. There is no check constraint on status, so no change is
-- needed for that. Two nullable columns record what happened:
--   approved_at      when the shop approved the post
--   preview_sent_at  when the 24-hour approval email went (so it goes once)
--
-- ADDITIVE ONLY.
alter table public.scheduled_posts add column if not exists approved_at timestamptz;
alter table public.scheduled_posts add column if not exists preview_sent_at timestamptz;
