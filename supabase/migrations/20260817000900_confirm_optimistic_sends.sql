-- 20260817000900_confirm_optimistic_sends.sql
--
-- Phase 2 groundwork, forced by building the UI: the WhatsApp deep-link flow (PLAN.md
-- section 6, Option A) writes an activity with is_optimistic = true because we open
-- WhatsApp but cannot observe the send. The plan's mitigation is "a one-tap 'log outcome'
-- prompt when the broker returns to the app" -- and 20260817000500 makes that impossible,
-- because lead_activities_update_own_note allows updates only on type = 'note'.
--
-- That original policy is right about the principle: the timeline is evidence, and a broker
-- must not be able to rewrite what a call or a message said after the fact. So this does
-- not widen it to "authors may edit their activities". It grants exactly one transition:
--
--   the author of an unconfirmed entry may record whether it actually went out.
--
-- Enforced in two parts, following the same split as the rest of the schema -- RLS decides
-- which rows, a trigger decides which columns.

drop policy if exists lead_activities_update_own_note on public.lead_activities;

create policy lead_activities_update_own on public.lead_activities
  for update to authenticated
  using (
    actor_id = (select app_private.current_profile_id())
    and (
      type = 'note'
      -- Only while still unconfirmed. Once outcome is set the row is closed to further
      -- edits, so this cannot be used to flip a send back and forth.
      or (is_optimistic and outcome is null)
    )
  )
  with check (
    actor_id = (select app_private.current_profile_id())
    and (type = 'note' or is_optimistic is not null)
  );

-- Column guard. On a note, the author may rewrite the body. On anything else, the only
-- fields that may move are `outcome` and `is_optimistic` -- the body, the type, the
-- timestamp and the lead it belongs to are all frozen.
create or replace function app_private.guard_activity_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app_private.is_admin()) then
    return new;
  end if;

  if new.lead_id is distinct from old.lead_id
     or new.actor_id is distinct from old.actor_id
     or new.type is distinct from old.type
     or new.occurred_at is distinct from old.occurred_at
  then
    raise exception 'A timeline entry cannot be moved or reattributed' using errcode = '42501';
  end if;

  if old.type <> 'note' then
    if new.body is distinct from old.body then
      raise exception 'Only the outcome of a sent message can be recorded, not its text'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_activity_columns on public.lead_activities;
create trigger guard_activity_columns
  before update on public.lead_activities
  for each row execute function app_private.guard_activity_columns();

comment on policy lead_activities_update_own on public.lead_activities is
  'Authors may edit their own notes, and may confirm an unconfirmed optimistic send exactly once.';
