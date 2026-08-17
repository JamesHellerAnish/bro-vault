-- 20260817001000_lead_assignment_time.sql
--
-- Closes a gap carried since Phase 1 and flagged in both phase docs: public.unattended_leads
-- measured "how long has this sat untouched" from leads.created_at, because nothing recorded
-- when a lead was actually assigned to its current owner.
--
-- That made the alert wrong in the exact case it exists to catch. PLAN.md section 7 asks for
-- leads "assigned more than 24h ago with zero activity". Reassigning a three-week-old
-- stalled lead to a new broker gave that broker a lead that was already ~500 hours
-- "unattended" on arrival -- so it screamed immediately, on their first day with it, and the
-- admin learns to ignore the panel. An alert that is always red is not an alert.

-- Backfill before the NOT NULL, and from created_at rather than now(): for a lead that has
-- never been reassigned, the moment it was created IS the moment it was assigned, and using
-- now() would silently reset every existing lead's clock at migration time.
alter table public.leads add column if not exists assigned_at timestamptz;

update public.leads set assigned_at = created_at where assigned_at is null;

alter table public.leads alter column assigned_at set not null;

-- Deliberately NO column default. The BEFORE trigger below fills it, and it needs to be
-- able to tell "the caller supplied a value" from "the caller supplied nothing" -- a
-- DEFAULT would have already substituted now() by the time the trigger runs, making the
-- two indistinguishable and forcing every historical import to today's date.
-- A BEFORE INSERT trigger runs before the NOT NULL check, so the column stays NOT NULL.
alter table public.leads alter column assigned_at drop default;

comment on column public.leads.assigned_at is
  'When the lead landed with its current owner. Reset on reassignment, so the unattended-lead clock restarts for the new broker.';

-- Stamped in a BEFORE trigger rather than trusted from the client, for the same reason as
-- first_contacted_at and converted_at (Phase 1): a metric the client can set is a metric the
-- client can skew. Here the specific abuse is dating a lead *forward* so it never crosses
-- the unattended threshold and never appears on the admin's alert panel.
--
-- The one exception is bulk import. Loading a spreadsheet of existing leads (PLAN.md section
-- 12 item 4) or seeding a dev database has to preserve real historical assignment dates, or
-- every imported lead arrives looking brand new. So a supplied value is honoured only for
-- callers who are not ordinary brokers: an admin, or a context with no profile at all
-- (service_role, migrations, seed.sql). A broker's value is always discarded.
create or replace function app_private.stamp_assignment_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid    := (select app_private.current_profile_id());
  v_is_broker boolean := v_actor is not null and not (select app_private.is_admin());
begin
  if tg_op = 'INSERT' then
    if new.assigned_at is null or v_is_broker then
      new.assigned_at := now();
    end if;
    return new;
  end if;

  -- Reassignment restarts the clock: that is the entire point of the column.
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := now();
  elsif v_is_broker then
    -- Not reassigning, so a broker has no business moving this at all.
    new.assigned_at := old.assigned_at;
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_assignment_time on public.leads;
create trigger stamp_assignment_time
  before insert or update on public.leads
  for each row execute function app_private.stamp_assignment_time();

-- Index mirrors the one on created_at: the alert scans by age within open leads.
create index if not exists leads_assigned_at_idx on public.leads (assigned_at);

-- ---------------------------------------------------------------------------
-- Re-point the alert at the new column
-- ---------------------------------------------------------------------------
-- DROP first, not CREATE OR REPLACE. The argument signature is unchanged, but the RETURNS
-- TABLE gains an `assigned_at` column, and Postgres rejects any change to a function's
-- return type with "cannot change return type of existing function" -- replace only works
-- when the output shape is identical.
drop function if exists public.unattended_leads(integer);

-- `hours_waiting` now means "hours since this broker got it", which is what the column
-- always claimed to mean.
create function public.unattended_leads(p_limit integer default 100)
returns table (
  lead_id       uuid,
  full_name     text,
  phone         text,
  status        public.lead_status,
  temperature   public.lead_temperature,
  assigned_to   uuid,
  broker_name   text,
  created_at    timestamptz,
  assigned_at   timestamptz,
  hours_waiting numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours integer := (select unattended_lead_hours from public.org_settings where id);
begin
  perform app_private.require_admin();

  return query
  select l.id, l.full_name, l.phone, l.status, l.temperature,
         l.assigned_to, p.full_name,
         l.created_at,
         l.assigned_at,
         round(extract(epoch from (now() - l.assigned_at)) / 3600.0, 1)
  from public.leads l
  join public.profiles p on p.id = l.assigned_to
  where public.is_open_status(l.status)
    and l.assigned_at < now() - make_interval(hours => v_hours)
    -- Activity by anyone, not just the current owner: if the previous broker called the
    -- client an hour before handing it over, the lead is not unattended, it is in progress.
    and not exists (
      select 1 from public.lead_activities a
      where a.lead_id = l.id
        and a.type in ('call', 'whatsapp', 'email', 'meeting')
        and a.occurred_at >= l.assigned_at
    )
  order by l.assigned_at
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.unattended_leads(integer) from public, anon;
grant execute on function public.unattended_leads(integer) to authenticated, service_role;
