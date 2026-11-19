-- retailers.voice_profile: how a shop's posts and review replies should sound.
--
-- A small JSON object (lib/voice.ts): tone, sign-off, words to use, words to
-- avoid, a short description of the business, and its specialities. Captured by
-- a few short questions at onboarding, or entered by a rep in /admin/pilot.
-- Null means "no preference", and the prompts use their default wording.
--
-- The application validates the contents on the way in AND on the way out
-- (readStoredVoice), so nothing here is trusted just because it is stored.
--
-- voice_updated_by records who last changed it: the shop itself, or a rep.
--
-- ADDITIVE ONLY: three nullable columns. retailers already has RLS
-- (20261115090000), so no policy changes are needed.
alter table public.retailers add column if not exists voice_profile jsonb;
alter table public.retailers add column if not exists voice_updated_at timestamptz;
alter table public.retailers add column if not exists voice_updated_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'retailers_voice_updated_by_check') then
    alter table public.retailers
      add constraint retailers_voice_updated_by_check
      check (voice_updated_by is null or voice_updated_by in ('shop', 'rep'));
  end if;
end $$;
