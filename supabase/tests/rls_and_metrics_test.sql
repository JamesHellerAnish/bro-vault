-- supabase/tests/rls_and_metrics_test.sql
-- Run with: supabase test db      (needs the local stack up: supabase start)
--
-- This suite exists because of one line in PLAN.md section 14: "a subtly wrong policy leaks
-- every broker's leads and looks fine in testing." A policy that is too permissive produces
-- no error, no warning and no visible symptom -- the app works, and it works for rows it
-- should not have returned. The only way to know is to become each role and count.
--
-- So every test below asserts from inside a role, using the same code path PostgREST uses:
-- `set local role authenticated` plus a `request.jwt.claims` sub, which is what auth.uid()
-- reads. Testing as `postgres` would prove nothing at all -- the table owner bypasses RLS.
--
-- Negative assertions carry the weight here. "Broker A can see their own lead" is nice;
-- "Broker A sees exactly zero of Broker B's leads, activities, status history and audit
-- entries" is the test that matters.

begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures, created as the table owner (RLS bypassed here, by design)
-- ---------------------------------------------------------------------------
-- Auth users first. The on_auth_user_created trigger links them to profiles by phone
-- digits, so profiles must exist before these rows land -- which is also the real
-- pre-registration sequence from PLAN.md section 1.

insert into public.profiles (id, full_name, phone, role, is_active) values
  ('00000000-0000-0000-0000-0000000000b1', 'Asha Admin',   '+919000000001', 'admin',  true),
  ('00000000-0000-0000-0000-0000000000b2', 'Broker A',     '+919000000002', 'broker', true),
  ('00000000-0000-0000-0000-0000000000b3', 'Broker B',     '+919000000003', 'broker', true),
  ('00000000-0000-0000-0000-0000000000b4', 'Broker Gone',  '+919000000004', 'broker', false);

-- auth.users.phone has no '+' -- the linking trigger normalises to digits. If that
-- normalisation is ever broken, these four linkage assertions fail immediately.
insert into auth.users (instance_id, id, aud, role, phone, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', '919000000001', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', '919000000002', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3',
   'authenticated', 'authenticated', '919000000003', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4',
   'authenticated', 'authenticated', '919000000004', now(), now(), '{}'::jsonb, '{}'::jsonb);

select is(
  (select auth_uid from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  'auth.users is linked to the pre-registered profile by phone digits'
);

insert into public.leads (id, full_name, phone, assigned_to, created_by, is_private, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'Lead of A', '+919812340001',
   '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', false, 'new'),
  ('00000000-0000-0000-0000-0000000000c2', 'Lead of B', '+919812340002',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b3', false, 'new'),
  ('00000000-0000-0000-0000-0000000000c3', 'VIP of B',  '+919812340003',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b3', true,  'new');

insert into public.lead_activities (lead_id, actor_id, type, direction, body) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b3',
   'call', 'out', 'Spoke about health cover');

update public.org_settings set lead_visibility = 'assigned_only', allow_cross_broker_edit = false;

-- Convenience: become a given user for the rest of the transaction.
create or replace function pg_temp.become(p_auth_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', p_auth_uid, 'role', 'authenticated')::text);
end;
$$;

create or replace function pg_temp.become_anon() returns void
language plpgsql as $$
begin
  execute 'set local role anon';
  execute 'set local request.jwt.claims to ' || quote_literal('{"role":"anon"}');
end;
$$;

create or replace function pg_temp.become_owner() returns void
language plpgsql as $$
begin
  execute 'set local role postgres';
  execute 'set local request.jwt.claims to ' || quote_literal('null');
end;
$$;

-- ===========================================================================
-- 1. Closed mode: a broker sees only what is assigned to them
-- ===========================================================================
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');

select is((select count(*) from public.leads), 1::bigint,
  'closed mode: broker A sees exactly their own lead');
select is((select count(*) from public.leads
             where id = '00000000-0000-0000-0000-0000000000c2'), 0::bigint,
  'closed mode: broker A cannot see broker B''s lead by id');
select is((select count(*) from public.lead_activities), 0::bigint,
  'closed mode: broker A sees none of broker B''s timeline');
select is((select count(*) from public.lead_status_history
             where lead_id = '00000000-0000-0000-0000-0000000000c2'), 0::bigint,
  'closed mode: status history follows the lead it belongs to');

select pg_temp.become('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.leads), 2::bigint,
  'closed mode: broker B sees both of their own leads');

select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.leads), 3::bigint,
  'admin sees every lead regardless of mode');

-- A deactivated broker keeps their history but loses all access, because
-- current_profile_id() filters on is_active.
select pg_temp.become('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.leads), 0::bigint,
  'a deactivated broker sees nothing');
select is((select count(*) from public.profiles), 0::bigint,
  'a deactivated broker cannot even read the team directory');

select pg_temp.become_anon();
-- `anon` holds no grant of any kind on public.leads -- only `authenticated` is granted DML
-- there, and no migration grants anon anything. So the refusal happens at the privilege
-- layer and never reaches RLS: the statement errors rather than returning zero rows.
--
-- That is strictly stronger than an RLS filter yielding an empty set (the table is
-- unreachable, not merely empty), so this asserts the error. Asserting a count here would
-- have required granting anon SELECT to make it pass -- opening a public read surface in
-- order to test that no public read surface exists.
select throws_ok($$ select count(*) from public.leads $$, '42501', null,
  'anon sees nothing: there is no public surface');

-- ===========================================================================
-- 2. Open mode: everyone reads, only the owner writes
-- ===========================================================================
select pg_temp.become_owner();
update public.org_settings set lead_visibility = 'all';

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');

select is((select count(*) from public.leads), 2::bigint,
  'open mode: broker A now sees B''s ordinary lead, but not the private one');
select is((select count(*) from public.leads
             where id = '00000000-0000-0000-0000-0000000000c3'), 0::bigint,
  'open mode: is_private still hides a lead from non-owners');

-- The read-only rule. An UPDATE blocked by RLS is not an error -- it silently matches zero
-- rows, which is exactly the failure mode that hides a broken policy. So assert the value.
update public.leads set city = 'Hijacked'
  where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.become_owner();
select is((select city from public.leads where id = '00000000-0000-0000-0000-0000000000c2'),
  null,
  'open mode: a non-owner cannot edit -- the row is untouched, not just the response');

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.lead_activities), 1::bigint,
  'open mode: a readable lead brings its timeline with it');

select throws_ok($$
  insert into public.lead_activities (lead_id, actor_id, type, body)
  values ('00000000-0000-0000-0000-0000000000c2',
          '00000000-0000-0000-0000-0000000000b2', 'note', 'appended by a non-owner')
$$, '42501', null,
'open mode: read access does not grant the right to append to someone else''s timeline');

-- ===========================================================================
-- 3. Open mode + allow_cross_broker_edit
-- ===========================================================================
select pg_temp.become_owner();
update public.org_settings set allow_cross_broker_edit = true;

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
update public.leads set city = 'Kolkata'
  where id = '00000000-0000-0000-0000-0000000000c2';

select pg_temp.become_owner();
select is((select city from public.leads where id = '00000000-0000-0000-0000-0000000000c2'),
  'Kolkata',
  'allow_cross_broker_edit lets a non-owner edit an ordinary lead');

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
update public.leads set city = 'Hijacked'
  where id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.become_owner();
select is((select city from public.leads where id = '00000000-0000-0000-0000-0000000000c3'),
  null,
  'allow_cross_broker_edit never reaches a lead flagged private');

update public.org_settings set lead_visibility = 'assigned_only', allow_cross_broker_edit = false;

-- ===========================================================================
-- 4. Column guards -- the rules RLS cannot express
-- ===========================================================================
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');

-- Two independent defences fire here: the guard trigger, and the leads_update WITH CHECK
-- (the new assigned_to is not a row this broker could write). Both raise 42501.
select throws_ok($$
  update public.leads set assigned_to = '00000000-0000-0000-0000-0000000000b3'
   where id = '00000000-0000-0000-0000-0000000000c1'
$$, '42501', null,
'a broker cannot reassign a lead away from themselves');

select throws_ok($$
  update public.leads set is_private = true
   where id = '00000000-0000-0000-0000-0000000000c1'
$$, '42501', null,
'a broker cannot flip the privacy flag on a lead they own');

select throws_ok($$
  update public.profiles set role = 'admin'
   where id = '00000000-0000-0000-0000-0000000000b2'
$$, '42501', null,
'a broker cannot promote themselves to admin');

-- Not a throws_ok: the profiles_update USING clause never matches a colleague's row, so
-- this update quietly affects nothing rather than raising. That silence is the point --
-- the guard trigger is the second line of defence, and it is never even reached here.
update public.profiles set is_active = true
 where id = '00000000-0000-0000-0000-0000000000b4';

select pg_temp.become_owner();
select is((select is_active from public.profiles
            where id = '00000000-0000-0000-0000-0000000000b4'), false,
  'a broker cannot reactivate a deactivated colleague');
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');

select lives_ok($$
  update public.profiles set full_name = 'Broker A (updated)'
   where id = '00000000-0000-0000-0000-0000000000b2'
$$, 'a broker can still edit their own display name');

-- ===========================================================================
-- 5. Creating leads and activities
-- ===========================================================================
select throws_ok($$
  insert into public.leads (full_name, phone, assigned_to, created_by)
  values ('Planted', '+919812340009',
          '00000000-0000-0000-0000-0000000000b3',
          '00000000-0000-0000-0000-0000000000b2')
$$, '42501', null,
'a broker cannot create a lead assigned to someone else');

select throws_ok($$
  insert into public.leads (full_name, phone, assigned_to, created_by)
  values ('Forged author', '+919812340010',
          '00000000-0000-0000-0000-0000000000b2',
          '00000000-0000-0000-0000-0000000000b3')
$$, '42501', null,
'created_by cannot be forged');

select throws_ok($$
  insert into public.lead_activities (lead_id, actor_id, type, body)
  values ('00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000b3', 'call', 'logged under a colleague')
$$, '42501', null,
'a broker cannot log an activity under another broker''s name');

select lives_ok($$
  insert into public.lead_activities (lead_id, actor_id, type, direction, body)
  values ('00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000b2', 'call', 'out', 'first call')
$$, 'a broker can log activity on their own lead');

-- first_contacted_at is derived from that activity, not from anything the client sent.
select isnt((select first_contacted_at from public.leads
              where id = '00000000-0000-0000-0000-0000000000c1'),
  null, 'the first outbound activity stamps first_contacted_at');

-- ===========================================================================
-- 6. Append-only surfaces
-- ===========================================================================
select throws_ok($$
  insert into public.lead_status_history (lead_id, to_status)
  values ('00000000-0000-0000-0000-0000000000c1', 'converted')
$$, '42501', null,
'status history cannot be written by a client');

select is((select count(*) from public.audit_log), 0::bigint,
  'the audit log is invisible to a broker');

select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select isnt((select count(*) from public.audit_log), 0::bigint,
  'the audit log is visible to the admin');

-- ===========================================================================
-- 7. Metric functions -- the clamp, and the refusals
-- ===========================================================================
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');

-- Broker A asks for Broker B's numbers. The answer must be Broker A's own numbers, not an
-- error and certainly not B's. Comparing against the unscoped call proves the parameter was
-- ignored rather than merely rejected.
select is(
  (select leads_received from public.broker_metrics('00000000-0000-0000-0000-0000000000b3')),
  (select leads_received from public.broker_metrics(null)),
  'broker_metrics clamps a broker to their own slice whatever broker_id they pass'
);

select throws_ok($$ select * from public.broker_leaderboard() $$, '42501', null,
'the org leaderboard refuses a broker outright');
select throws_ok($$ select * from public.source_performance() $$, '42501', null,
'source performance refuses a broker outright');
select throws_ok($$ select * from public.unattended_leads() $$, '42501', null,
'the unattended-leads alert refuses a broker outright');

select is((select id from public.me()), '00000000-0000-0000-0000-0000000000b2'::uuid,
  'me() returns the calling broker''s own profile');

select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select * from public.broker_leaderboard() $$,
  'the admin can read the leaderboard');

select pg_temp.become_owner();
select * from finish();
rollback;
