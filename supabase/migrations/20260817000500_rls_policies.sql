-- 20260817000500_rls_policies.sql
-- Phase 1 / step 5: row level security policies. PLAN.md section 4.
--
-- Reading order for each table: SELECT, then INSERT, then UPDATE, then DELETE. A command
-- with no policy is denied to everyone -- that is the intended state for several of them
-- (nobody deletes a profile, nobody rewrites the audit log) and it is deliberate, not an
-- oversight.
--
-- Every policy is scoped `to authenticated`. `anon` therefore matches nothing anywhere in
-- this file, which is the correct posture for a product with no public signup.
--
-- Parameterless helpers are always written as `(select app_private.f())` so the planner
-- folds them into a single InitPlan instead of calling them once per row. This is a
-- performance idiom with no effect on semantics -- but writing it the other way turns a
-- paginated leads query into thousands of function calls.

-- ---------------------------------------------------------------------------
-- Table privileges. RLS filters rows; grants decide whether the role may attempt the
-- command at all. Both have to line up.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- Supabase's default privileges hand `anon` full access to every *future* table in public.
-- Without this, the next migration that adds a table silently re-opens the hole that the
-- line above just closed -- and it would not show up in review, because the grant is
-- invisible in the CREATE TABLE statement.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

grant select on
  public.profiles, public.org_settings, public.traits, public.lead_sources,
  public.insurance_types, public.templates, public.leads, public.lead_traits,
  public.lead_insurance_types, public.lead_activities, public.lead_status_history,
  public.policies, public.notifications, public.audit_log
  to authenticated;

grant insert, update on public.profiles to authenticated;
grant update on public.org_settings to authenticated;
grant insert, update, delete on
  public.traits, public.lead_sources, public.insurance_types, public.templates
  to authenticated;
grant insert, update, delete on
  public.leads, public.lead_traits, public.lead_insurance_types,
  public.lead_activities, public.policies, public.notifications
  to authenticated;

-- Note what is absent: no insert/update/delete on lead_status_history or audit_log for
-- anyone. Both are written only by SECURITY DEFINER triggers (20260817000600).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- The whole team can read the directory: a lead card shows "Assigned: Ankit" with a photo,
-- and the reassignment picker needs the broker list. This exposes colleagues' work contact
-- details to colleagues, which is the intent for an internal tool -- but it is a real
-- decision, so it is stated here rather than left implicit.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select app_private.is_active_user()));

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check ((select app_private.is_admin()));

-- Self-service edits are allowed at the row level; which *columns* a non-admin may change
-- is enforced by a trigger, because admin and broker are the same Postgres role and column
-- privileges cannot tell them apart.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (select app_private.is_admin())
    or id = (select app_private.current_profile_id())
  )
  with check (
    (select app_private.is_admin())
    or id = (select app_private.current_profile_id())
  );

-- No DELETE policy, on purpose. Brokers are deactivated (is_active = false), never
-- deleted -- their leads, activities and history stay attributable.

-- ---------------------------------------------------------------------------
-- org_settings
-- ---------------------------------------------------------------------------
-- Readable by the whole team because the client needs to know which visibility mode it is
-- rendering. Knowing the mode is not the same as being able to change it.
drop policy if exists org_settings_select on public.org_settings;
create policy org_settings_select on public.org_settings
  for select to authenticated
  using ((select app_private.is_active_user()));

drop policy if exists org_settings_update_admin on public.org_settings;
create policy org_settings_update_admin on public.org_settings
  for update to authenticated
  using ((select app_private.is_admin()))
  with check ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- Admin-editable vocabularies
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['traits', 'lead_sources', 'insurance_types']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using ((select app_private.is_active_user()))
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_write_admin', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ((select app_private.is_admin()))
        with check ((select app_private.is_admin()))
    $f$, t || '_write_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- leads -- the rule from PLAN.md section 4
-- ---------------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (app_private.can_read_lead_row(assigned_to, is_private));

-- A broker may only create leads owned by themselves; the admin may assign anywhere.
-- `created_by` is pinned to the caller so authorship cannot be forged.
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    (select app_private.is_active_user())
    and created_by = (select app_private.current_profile_id())
    and (
      (select app_private.is_admin())
      or assigned_to = (select app_private.current_profile_id())
    )
  );

-- Both USING and WITH CHECK, and both use the *write* rule. Omitting WITH CHECK would let
-- a broker edit a lead they own into a state they could not have created.
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (app_private.can_write_lead_row(assigned_to, is_private))
  with check (app_private.can_write_lead_row(assigned_to, is_private));

-- Deleting a lead destroys its timeline and its conversion history, so it is admin-only.
-- The broker-facing equivalent is the `lost` / `do_not_contact` off-ramp.
drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads
  for delete to authenticated
  using ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- Lead child tables -- all inherit the parent's rule via can_read_lead / can_write_lead
-- ---------------------------------------------------------------------------
drop policy if exists lead_traits_select on public.lead_traits;
create policy lead_traits_select on public.lead_traits
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

drop policy if exists lead_traits_write on public.lead_traits;
create policy lead_traits_write on public.lead_traits
  for all to authenticated
  using (app_private.can_write_lead(lead_id))
  with check (app_private.can_write_lead(lead_id));

drop policy if exists lead_insurance_types_select on public.lead_insurance_types;
create policy lead_insurance_types_select on public.lead_insurance_types
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

drop policy if exists lead_insurance_types_write on public.lead_insurance_types;
create policy lead_insurance_types_write on public.lead_insurance_types
  for all to authenticated
  using (app_private.can_write_lead(lead_id))
  with check (app_private.can_write_lead(lead_id));

-- ---------------------------------------------------------------------------
-- lead_activities -- the timeline
-- ---------------------------------------------------------------------------
drop policy if exists lead_activities_select on public.lead_activities;
create policy lead_activities_select on public.lead_activities
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

-- Logging an activity is a write on the lead, so it needs write access -- a read-only
-- viewer in open mode cannot append to someone else's timeline. `actor_id` is pinned to
-- the caller: a broker cannot log a call under a colleague's name.
drop policy if exists lead_activities_insert on public.lead_activities;
create policy lead_activities_insert on public.lead_activities
  for insert to authenticated
  with check (
    app_private.can_write_lead(lead_id)
    and actor_id = (select app_private.current_profile_id())
  );

-- The timeline is evidence. Only free-text notes are editable, only by their author.
-- Calls, messages and system-generated entries are immutable once written.
drop policy if exists lead_activities_update_own_note on public.lead_activities;
create policy lead_activities_update_own_note on public.lead_activities
  for update to authenticated
  using (
    type = 'note'
    and actor_id = (select app_private.current_profile_id())
  )
  with check (
    type = 'note'
    and actor_id = (select app_private.current_profile_id())
  );

drop policy if exists lead_activities_delete_admin on public.lead_activities;
create policy lead_activities_delete_admin on public.lead_activities
  for delete to authenticated
  using ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- lead_status_history -- readable, never writable by a client
-- ---------------------------------------------------------------------------
drop policy if exists lead_status_history_select on public.lead_status_history;
create policy lead_status_history_select on public.lead_status_history
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

-- ---------------------------------------------------------------------------
-- policies (issued business)
-- ---------------------------------------------------------------------------
drop policy if exists policies_select on public.policies;
create policy policies_select on public.policies
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

drop policy if exists policies_insert on public.policies;
create policy policies_insert on public.policies
  for insert to authenticated
  with check (app_private.can_write_lead(lead_id));

drop policy if exists policies_update on public.policies;
create policy policies_update on public.policies
  for update to authenticated
  using (app_private.can_write_lead(lead_id))
  with check (app_private.can_write_lead(lead_id));

-- Premium and commission figures feed the admin's revenue numbers; brokers do not remove them.
drop policy if exists policies_delete_admin on public.policies;
create policy policies_delete_admin on public.policies
  for delete to authenticated
  using ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- templates -- admin owns the library, brokers stay on-script (PLAN.md section 6)
-- ---------------------------------------------------------------------------
drop policy if exists templates_select on public.templates;
create policy templates_select on public.templates
  for select to authenticated
  using (
    (select app_private.is_admin())
    or ((select app_private.is_active_user()) and is_active)
  );

drop policy if exists templates_write_admin on public.templates;
create policy templates_write_admin on public.templates
  for all to authenticated
  using ((select app_private.is_admin()))
  with check ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select app_private.current_profile_id()));

-- Marking your own notification read. A trigger pins this to the `read_at` column so the
-- update cannot be used to rewrite the payload.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select app_private.current_profile_id()))
  with check (user_id = (select app_private.current_profile_id()));

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = (select app_private.current_profile_id()));

-- Only the admin can hand-write a notification to someone. Everything else arrives from a
-- SECURITY DEFINER trigger or an Edge Function.
drop policy if exists notifications_insert_admin on public.notifications;
create policy notifications_insert_admin on public.notifications
  for insert to authenticated
  with check ((select app_private.is_admin()));

-- ---------------------------------------------------------------------------
-- audit_log -- read-only, admin-only, append-only
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select app_private.is_admin()));

-- No INSERT, UPDATE or DELETE policy exists for any client role. The log is written by
-- definer triggers and cannot be edited afterwards, including by the admin.
