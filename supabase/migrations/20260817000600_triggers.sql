-- 20260817000600_triggers.sql
-- Phase 1 / step 6: column guards, derived timestamps, the activity timeline, and audit.
--
-- Why triggers and not policies: RLS is row-level. It can say "you may update this lead",
-- but it cannot say "you may update every column except assigned_to". Column privileges
-- cannot help either -- admin and broker are both the Postgres role `authenticated`, and a
-- GRANT cannot tell them apart. So every "which fields may this person change" rule lives
-- in a BEFORE trigger, and each one raises rather than silently discarding the change.
--
-- Every function here is SECURITY DEFINER with a pinned search_path, for the same reasons
-- as 20260817000400. Definer also lets the audit and history triggers write to tables that
-- have no client-facing INSERT policy at all.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'org_settings', 'leads', 'policies', 'templates']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app_private.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: which columns a non-admin may change
-- ---------------------------------------------------------------------------
-- Without this, the profiles_update policy ("or id = me") would let any broker set their
-- own role to 'admin'. That single line is the difference between self-service profile
-- editing and full privilege escalation.
create or replace function app_private.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app_private.is_admin()) then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only an admin can change a role' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Only an admin can activate or deactivate a broker' using errcode = '42501';
  end if;
  if new.phone is distinct from old.phone then
    raise exception 'Only an admin can change the login phone number' using errcode = '42501';
  end if;
  if new.auth_uid is distinct from old.auth_uid then
    raise exception 'auth_uid is managed by the auth trigger' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'Profile id is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_columns on public.profiles;
create trigger guard_profile_columns
  before update on public.profiles
  for each row execute function app_private.guard_profile_columns();

-- ---------------------------------------------------------------------------
-- leads: which columns a non-admin may change
-- ---------------------------------------------------------------------------
-- Reassignment and the per-lead privacy flag are admin powers (PLAN.md section 5: the
-- reassign control is drawn admin-only). A broker who could set `assigned_to` could hand
-- themselves any lead in the org while in open mode; one who could clear `is_private`
-- could unhide a VIP case.
create or replace function app_private.guard_lead_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app_private.is_admin()) then
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only an admin can reassign a lead' using errcode = '42501';
  end if;
  if new.is_private is distinct from old.is_private then
    raise exception 'Only an admin can change the privacy flag on a lead' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lead_columns on public.leads;
create trigger guard_lead_columns
  before update on public.leads
  for each row execute function app_private.guard_lead_columns();

-- ---------------------------------------------------------------------------
-- leads: derived timestamps
-- ---------------------------------------------------------------------------
-- These drive "average conversion time" (PLAN.md section 7). Deriving them in the database
-- rather than trusting the client means the metric cannot be skewed by a screen that
-- forgot to set a field.
create or replace function app_private.apply_lead_status_timestamps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'converted' and new.converted_at is null then
      new.converted_at := now();
    end if;
    if new.status = 'lost' and new.lost_at is null then
      new.lost_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'converted' then
      -- Only on the first conversion; re-entering the stage must not reset the clock.
      new.converted_at := coalesce(old.converted_at, now());
    end if;
    if new.status = 'lost' then
      new.lost_at := coalesce(old.lost_at, now());
    end if;
    -- Reopening a lead clears the terminal stamp, otherwise it would be counted as both
    -- converted and open in the funnel.
    if public.is_open_status(new.status) then
      new.converted_at := null;
      new.lost_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_lead_status_timestamps on public.leads;
create trigger apply_lead_status_timestamps
  before insert or update on public.leads
  for each row execute function app_private.apply_lead_status_timestamps();

-- ---------------------------------------------------------------------------
-- leads: status history and the timeline entry
-- ---------------------------------------------------------------------------
create or replace function app_private.log_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app_private.current_profile_id());
begin
  if tg_op = 'INSERT' then
    insert into public.lead_status_history (lead_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, coalesce(v_actor, new.created_by));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.lead_status_history (lead_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, v_actor);

    insert into public.lead_activities (lead_id, actor_id, type, body, occurred_at)
    values (new.id, v_actor, 'status_change',
            format('Status changed from %s to %s', old.status, new.status), now());
  end if;

  return new;
end;
$$;

drop trigger if exists log_lead_status_change on public.leads;
create trigger log_lead_status_change
  after insert or update on public.leads
  for each row execute function app_private.log_lead_status_change();

-- ---------------------------------------------------------------------------
-- leads: assignment -> timeline entry + notification to the new owner
-- ---------------------------------------------------------------------------
create or replace function app_private.log_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app_private.current_profile_id());
  v_from  text;
  v_to    text;
begin
  -- On insert: notify only when the lead lands on someone other than its creator, so a
  -- broker adding their own lead does not get a notification about themselves.
  if tg_op = 'INSERT' then
    if new.assigned_to is distinct from new.created_by then
      insert into public.notifications (user_id, type, payload)
      values (new.assigned_to, 'lead_assigned',
              jsonb_build_object(
                'lead_id', new.id,
                'lead_name', new.full_name,
                'assigned_by', new.created_by));
    end if;
    return new;
  end if;

  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  select full_name into v_from from public.profiles where id = old.assigned_to;
  select full_name into v_to   from public.profiles where id = new.assigned_to;

  insert into public.lead_activities (lead_id, actor_id, type, body, occurred_at)
  values (new.id, v_actor, 'assignment',
          format('Reassigned from %s to %s', coalesce(v_from, 'unassigned'), coalesce(v_to, 'unassigned')),
          now());

  -- Written by a definer function because notifications_insert_admin is the only client
  -- INSERT policy, and this fires for admin-driven reassignment either way.
  insert into public.notifications (user_id, type, payload)
  values (new.assigned_to, 'lead_assigned',
          jsonb_build_object(
            'lead_id', new.id,
            'lead_name', new.full_name,
            'assigned_by', v_actor));

  return new;
end;
$$;

drop trigger if exists log_lead_assignment on public.leads;
create trigger log_lead_assignment
  after insert or update on public.leads
  for each row execute function app_private.log_lead_assignment();

-- ---------------------------------------------------------------------------
-- first contact, derived from the timeline
-- ---------------------------------------------------------------------------
-- "Average time to first contact" (PLAN.md section 7) is only trustworthy if the stamp is
-- set by the act of contacting, not by a checkbox. The first outbound call, WhatsApp,
-- email or meeting sets it; notes and inbound entries do not.
create or replace function app_private.stamp_first_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type in ('call', 'whatsapp', 'email', 'meeting')
     and coalesce(new.direction, 'out') = 'out'
  then
    update public.leads
       set first_contacted_at = new.occurred_at
     where id = new.lead_id
       and first_contacted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_first_contact on public.lead_activities;
create trigger stamp_first_contact
  after insert on public.lead_activities
  for each row execute function app_private.stamp_first_contact();

-- ---------------------------------------------------------------------------
-- notifications: a client update may only mark read
-- ---------------------------------------------------------------------------
create or replace function app_private.guard_notification_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.type is distinct from old.type
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A notification can only be marked read' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_notification_columns on public.notifications;
create trigger guard_notification_columns
  before update on public.notifications
  for each row execute function app_private.guard_notification_columns();

-- ---------------------------------------------------------------------------
-- audit log
-- ---------------------------------------------------------------------------
-- Deliberately selective. PLAN.md section 11 asks for an audit trail of reassignment,
-- status changes, exports and visibility flips -- not of every keystroke. Logging every
-- column would copy client PII and health hints out of `leads` and into a second table
-- with a different retention story, which is the opposite of what DPDP compliance wants.
create or replace function app_private.audit_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, entity, entity_id, action, diff)
    values ((select app_private.current_profile_id()), 'leads', old.id::text, 'delete',
            jsonb_build_object('full_name', old.full_name, 'status', old.status,
                               'assigned_to', old.assigned_to));
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, entity, entity_id, action, diff)
    values ((select app_private.current_profile_id()), 'leads', new.id::text, 'create',
            jsonb_build_object('assigned_to', new.assigned_to, 'status', new.status));
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    v_diff := v_diff || jsonb_build_object('assigned_to',
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  if new.status is distinct from old.status then
    v_diff := v_diff || jsonb_build_object('status',
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.is_private is distinct from old.is_private then
    v_diff := v_diff || jsonb_build_object('is_private',
      jsonb_build_object('from', old.is_private, 'to', new.is_private));
  end if;

  if v_diff <> '{}'::jsonb then
    insert into public.audit_log (actor_id, entity, entity_id, action, diff)
    values ((select app_private.current_profile_id()), 'leads', new.id::text, 'update', v_diff);
  end if;

  return new;
end;
$$;

drop trigger if exists audit_lead on public.leads;
create trigger audit_lead
  after insert or update or delete on public.leads
  for each row execute function app_private.audit_lead();

-- Full diffs are safe on these three: they hold configuration and staff records, not
-- client data. The visibility switch flip lands here.
create or replace function app_private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_diff jsonb;
  v_id   text;
begin
  if tg_op = 'DELETE' then
    v_diff := to_jsonb(old);
    v_id   := coalesce((to_jsonb(old) ->> 'id'), '');
  elsif tg_op = 'INSERT' then
    v_diff := to_jsonb(new);
    v_id   := coalesce((to_jsonb(new) ->> 'id'), '');
  else
    select jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_diff
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n on n.key = o.key
     where o.value is distinct from n.value;
    v_id := coalesce((to_jsonb(new) ->> 'id'), '');
    if v_diff is null then
      return new;
    end if;
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values ((select app_private.current_profile_id()), tg_table_name, v_id, lower(tg_op), v_diff);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'org_settings', 'templates']
  loop
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I
         for each row execute function app_private.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Linking an auth user to a pre-registered profile
-- ---------------------------------------------------------------------------
-- PLAN.md section 1: no public signup. The admin creates the profile row first; the broker
-- then logs in with phone + OTP and this links the two.
--
-- Supabase stores auth.users.phone as bare digits ("919876543210") while we store E.164
-- ("+919876543210"), so the match is on digits only. Getting this wrong looks like a
-- working login that lands on an empty app -- the auth session exists, no profile links to
-- it, and every RLS policy correctly returns nothing.
--
-- No exception is raised for an unknown phone. The signup itself is blocked in
-- supabase/config.toml (`enable_signup = false`); this trigger is the second layer, and an
-- unlinked auth user simply has no profile and therefore no access to anything.
create or replace function app_private.link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
begin
  if v_digits <> '' then
    update public.profiles p
       set auth_uid = new.id
     where p.auth_uid is null
       and regexp_replace(p.phone, '[^0-9]', '', 'g') = v_digits;
  end if;

  if not found and new.email is not null then
    update public.profiles p
       set auth_uid = new.id
     where p.auth_uid is null
       and lower(p.email) = lower(new.email);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.link_auth_user_to_profile();
