-- A shop's account made through an operator account starts with posts and
-- replies OFF.
--
-- users.auto_post_enabled and users.auto_reply_enabled default to true. That
-- default dates from when the only way to hold an account was to pay for one.
-- A shop set up by a rep through an operator account (users.managed_by_user_id
-- is set: lib/managed-access.ts) has never chosen anything, and may never
-- sign in. Left to the default, we would write posts and public replies on its
-- listing without it having agreed to either.
--
-- No code in the app creates such a row today: they are made by hand or by a
-- script. So the rule is put where it cannot be forgotten, in the database: on
-- INSERT, a row that names a managing account and has no mode chosen has both
-- switches set to false, whatever the insert said or left out. Once the shop
-- (or whoever acts for it) chooses a mode or switches something on, that is an
-- UPDATE, and this does not touch it.
--
-- The column defaults themselves are left alone: the other brand's accounts
-- are created relying on them.
--
-- ADDITIVE ONLY: one function and one trigger. No existing row is changed.
create or replace function public.operator_rows_start_off() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.managed_by_user_id is not null and new.automation_mode is null then
    new.auto_post_enabled := false;
    new.auto_reply_enabled := false;
  end if;
  return new;
end;
$$;

revoke all on function public.operator_rows_start_off() from public, anon, authenticated;

drop trigger if exists users_operator_rows_start_off on public.users;
create trigger users_operator_rows_start_off
  before insert on public.users
  for each row execute function public.operator_rows_start_off();
