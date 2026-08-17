-- 20260817000400_auth_helpers.sql
-- Phase 1 / step 4: the predicates that every security policy is built from.
--
-- This file is the security boundary of the product. Three rules hold everywhere in it:
--
--   1. Every function is SECURITY DEFINER with `set search_path = ''` and fully
--      schema-qualified identifiers. A definer function without a pinned search_path is a
--      privilege-escalation hole -- the caller can point `public` at their own schema and
--      substitute the tables the function reads.
--
--   2. Definer is required, not stylistic. `is_admin()` reads `public.profiles`, which is
--      itself under RLS whose policy calls `is_admin()`. As an invoker function that is
--      infinite recursion; as a definer function it bypasses RLS on profiles and terminates.
--
--   3. `current_profile_id()` returns null for a deactivated broker. Every downstream
--      predicate compares against it with `=`, and `x = null` is null, not true -- so
--      deactivating a broker revokes read and write access on the next query, with no
--      cascade and no history loss (PLAN.md section 1).
--
-- Performance note: these are STABLE, but the `set search_path` clause blocks SQL function
-- inlining, so a parameterless helper is evaluated once per candidate row unless the policy
-- wraps it as `(select app_private.is_admin())` -- which turns it into a one-shot InitPlan.
-- Every policy in 20260817000500 uses that form. The row-dependent helpers below cannot,
-- which is why the leads indexes in 20260817000300 lead with `assigned_to`: the candidate
-- set is already narrow before the predicate runs.

-- Policy expressions are evaluated with the *calling* role's privileges, so `authenticated`
-- must be able to reach these. That is safe: PostgREST is only configured to expose
-- `public`, so `app_private` is unreachable over the API even though the role can execute
-- its functions from inside a policy.
grant usage on schema app_private to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------
create or replace function app_private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_uid = (select auth.uid())
    and p.is_active
  limit 1
$$;

create or replace function app_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_uid = (select auth.uid())
      and p.is_active
  )
$$;

create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_uid = (select auth.uid())
      and p.is_active
      and p.role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- Org configuration, read past RLS
-- ---------------------------------------------------------------------------
-- Definer because the visibility rule must be readable while evaluating a policy, even for
-- a caller who cannot select org_settings.
create or replace function app_private.lead_visibility()
returns public.visibility_mode
language sql
stable
security definer
set search_path = ''
as $$
  select s.lead_visibility from public.org_settings s where s.id
$$;

create or replace function app_private.allow_cross_broker_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.allow_cross_broker_edit from public.org_settings s where s.id
$$;

-- ---------------------------------------------------------------------------
-- The visibility rule itself (PLAN.md section 4) -- defined exactly once
-- ---------------------------------------------------------------------------
-- Everything that reads a lead, or anything hanging off a lead, routes through these two.
-- Do not restate the rule inline anywhere else: two copies of a security predicate drift,
-- and the drift is silent.

create or replace function app_private.can_read_lead_row(
  p_assigned_to uuid,
  p_is_private  boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select app_private.is_active_user())
    and (
         (select app_private.is_admin())
      or p_assigned_to = (select app_private.current_profile_id())
      -- Open mode: everyone sees the lead, unless it is flagged private.
      or (not coalesce(p_is_private, true)
          and (select app_private.lead_visibility()) = 'all')
    )
$$;

comment on function app_private.can_read_lead_row is
  'Read rule for a lead: admin, or the assigned broker, or open mode on a non-private lead.';

create or replace function app_private.can_write_lead_row(
  p_assigned_to uuid,
  p_is_private  boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select app_private.is_active_user())
    and (
         (select app_private.is_admin())
      or p_assigned_to = (select app_private.current_profile_id())
      -- Non-owners are read-only in open mode. The admin can lift that with the
      -- allow_cross_broker_edit setting, but it is off by default and never applies to a
      -- lead flagged private.
      or (not coalesce(p_is_private, true)
          and (select app_private.lead_visibility()) = 'all'
          and (select app_private.allow_cross_broker_edit()))
    )
$$;

comment on function app_private.can_write_lead_row is
  'Write rule for a lead. Strictly narrower than can_read_lead_row: open mode grants read, not write.';

-- ---------------------------------------------------------------------------
-- Same rules, addressed by lead id -- used by every child table
-- ---------------------------------------------------------------------------
-- Definer so the lookup itself is not filtered by the leads policy. That is not a loophole:
-- the row it fetches is immediately fed through the same predicate the leads policy uses.
create or replace function app_private.can_read_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select app_private.can_read_lead_row(l.assigned_to, l.is_private)
     from public.leads l
     where l.id = p_lead_id),
    false)   -- no such lead => no access (and no existence oracle)
$$;

create or replace function app_private.can_write_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select app_private.can_write_lead_row(l.assigned_to, l.is_private)
     from public.leads l
     where l.id = p_lead_id),
    false)
$$;

revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to authenticated, service_role;
