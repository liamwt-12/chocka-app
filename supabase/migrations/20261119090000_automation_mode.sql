-- How a shop wants us to work: "hands-off" or "ask me first".
--
-- At onboarding the shop makes one choice (lib/automation-mode.ts). Choosing
-- hands-off is the shop's explicit permission for us to post and reply on its
-- listing without asking each time, so what it agreed to is recorded with it:
--
--   users.automation_mode             'hands_off' | 'ask_first' | null (not chosen
--                                     yet, which behaves exactly as ask-first)
--   users.automation_mode_chosen_at   when the choice was last made
--   users.automation_consent_at       when hands-off permission was given.
--                                     Kept if the shop later switches back, so
--                                     the record of what was agreed is not lost.
--   users.automation_consent_version  which wording the shop was shown when it
--                                     gave that permission
--   users.automation_paused_at        set while the shop has pressed Pause.
--                                     Nothing is posted or replied to until it
--                                     presses Resume.
--
-- ADDITIVE ONLY: five nullable columns and one check on a new column.
alter table public.users add column if not exists automation_mode text check (automation_mode is null or automation_mode in ('hands_off', 'ask_first'));
alter table public.users add column if not exists automation_mode_chosen_at timestamptz;
alter table public.users add column if not exists automation_consent_at timestamptz;
alter table public.users add column if not exists automation_consent_version text;
alter table public.users add column if not exists automation_paused_at timestamptz;
