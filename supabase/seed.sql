-- supabase/seed.sql
-- Local development data. Runs on `supabase db reset`, never against a deployed project.
--
-- The phone numbers here match the fixed OTPs in config.toml ([auth.sms.test_otp]), so you
-- can log in as any of these three with code 123456 and see the visibility rules behave.
--
-- Auth users are inserted directly, which is a local-only shortcut: in production the admin
-- creates the profile row and Supabase Auth creates the auth user on first OTP. The
-- on_auth_user_created trigger links them either way, which is why profiles come first here.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, email, phone, whatsapp_number, role, is_active) values
  ('11111111-1111-1111-1111-111111111111', 'Asha Sen (Admin)', 'asha@example.com',
   '+919000000001', '+919000000001', 'admin',  true),
  ('22222222-2222-2222-2222-222222222222', 'Ankit Roy', 'ankit@example.com',
   '+919000000002', '+919000000002', 'broker', true),
  ('33333333-3333-3333-3333-333333333333', 'Priya Das', 'priya@example.com',
   '+919000000003', '+919000000003', 'broker', true)
on conflict (phone) do nothing;

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', '919000000001', now(), now(), now(),
   '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', '919000000002', now(), now(), now(),
   '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', '919000000003', now(), now(), now(),
   '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Leads across both brokers, at different pipeline stages and different ages,
-- so the dashboard functions have something with shape to aggregate.
-- ---------------------------------------------------------------------------
insert into public.leads (
  id, full_name, phone, whatsapp_number, email, age, gender, city, state, pincode,
  occupation, annual_income_band, source_id, status, temperature, description,
  budget_expectation, preferred_language, consent_given, consent_at, whatsapp_opt_in,
  assigned_to, created_by, is_private, next_follow_up_at, created_at, assigned_at
)
select v.* from (values
  ('c0000001-0000-0000-0000-000000000001'::uuid, 'Ramesh Sharma', '+919812340001', '+919812340001',
   'ramesh@example.com', 42::smallint, 'male', 'Kolkata', 'West Bengal', '700019',
   'Small business owner', '10-15L',
   (select id from public.lead_sources where key = 'facebook_ad'),
   'quote_shared'::public.lead_status, 'hot'::public.lead_temperature,
   'Family of 4, wants 10L floater, worried about father''s diabetes exclusion',
   28000::numeric, 'hi', true, now() - interval '20 days', true,
   '22222222-2222-2222-2222-222222222222'::uuid, '22222222-2222-2222-2222-222222222222'::uuid,
   false, now() + interval '1 day', now() - interval '20 days', now() - interval '20 days'),

  ('c0000001-0000-0000-0000-000000000002'::uuid, 'Sunita Ghosh', '+919812340002', '+919812340002',
   null, 35::smallint, 'female', 'Howrah', 'West Bengal', '711101',
   'School teacher', '5-10L',
   (select id from public.lead_sources where key = 'referral'),
   'converted'::public.lead_status, 'hot'::public.lead_temperature,
   'Term life, 1Cr cover, wanted the cheapest option with a good claim ratio',
   14000::numeric, 'bn', true, now() - interval '45 days', true,
   '22222222-2222-2222-2222-222222222222'::uuid, '22222222-2222-2222-2222-222222222222'::uuid,
   false, null, now() - interval '45 days', now() - interval '45 days'),

  ('c0000001-0000-0000-0000-000000000003'::uuid, 'Imran Khan', '+919812340003', null,
   'imran@example.com', 29::smallint, 'male', 'Kolkata', 'West Bengal', '700016',
   'Software engineer', '15-25L',
   (select id from public.lead_sources where key = 'website'),
   'new'::public.lead_status, 'warm'::public.lead_temperature,
   'Enquired about travel insurance for a Schengen trip in December',
   6000::numeric, 'en', true, now() - interval '2 days', false,
   '22222222-2222-2222-2222-222222222222'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   false, now() - interval '1 day', now() - interval '2 days', now() - interval '2 days'),

  ('c0000001-0000-0000-0000-000000000004'::uuid, 'Debjani Roy', '+919812340004', '+919812340004',
   null, 51::smallint, 'female', 'Durgapur', 'West Bengal', '713201',
   'Doctor', '25L+',
   (select id from public.lead_sources where key = 'referral'),
   'negotiation'::public.lead_status, 'hot'::public.lead_temperature,
   'Senior citizen cover for her mother; comparing two insurers on pre-existing waiting period',
   55000::numeric, 'en', true, now() - interval '12 days', true,
   '33333333-3333-3333-3333-333333333333'::uuid, '33333333-3333-3333-3333-333333333333'::uuid,
   false, now(), now() - interval '12 days', now() - interval '12 days'),

  ('c0000001-0000-0000-0000-000000000005'::uuid, 'Arjun Mehta', '+919812340005', null,
   null, 38::smallint, 'male', 'Siliguri', 'West Bengal', '734001',
   'Trader', '10-15L',
   (select id from public.lead_sources where key = 'indiamart'),
   'not_reachable'::public.lead_status, 'cold'::public.lead_temperature,
   'Motor insurance renewal; four call attempts, no answer',
   9000::numeric, 'hi', false, null, false,
   '33333333-3333-3333-3333-333333333333'::uuid, '33333333-3333-3333-3333-333333333333'::uuid,
   false, null, now() - interval '30 days', now() - interval '30 days'),

  -- The private lead. In open mode this one still stays with Priya only.
  ('c0000001-0000-0000-0000-000000000006'::uuid, 'Corporate: Nabin Textiles', '+919812340006', null,
   'accounts@example.com', null::smallint, null, 'Kolkata', 'West Bengal', '700001',
   'Group HR', '25L+',
   (select id from public.lead_sources where key = 'existing_client'),
   'interested'::public.lead_status, 'warm'::public.lead_temperature,
   'Group health for 120 employees. Sensitive commercial terms -- flagged private.',
   1800000::numeric, 'en', true, now() - interval '6 days', false,
   '33333333-3333-3333-3333-333333333333'::uuid, '11111111-1111-1111-1111-111111111111'::uuid,
   true, now() + interval '3 days', now() - interval '6 days', now() - interval '6 days')
) as v
on conflict (id) do nothing;

-- Traits on a couple of leads, so the chips have something to render.
insert into public.lead_traits (lead_id, trait_id, added_by)
select 'c0000001-0000-0000-0000-000000000001', t.id, '22222222-2222-2222-2222-222222222222'
from public.traits t where t.key in ('price_sensitive', 'will_call_back', 'pre_existing_condition')
on conflict do nothing;

insert into public.lead_traits (lead_id, trait_id, added_by)
select 'c0000001-0000-0000-0000-000000000004', t.id, '33333333-3333-3333-3333-333333333333'
from public.traits t where t.key in ('comparing_brokers', 'senior_citizen', 'ready_to_buy')
on conflict do nothing;

insert into public.lead_insurance_types (lead_id, insurance_type_id)
select 'c0000001-0000-0000-0000-000000000001', i.id
from public.insurance_types i where i.key = 'health'
on conflict do nothing;

-- Timeline entries. The stamp_first_contact trigger sets first_contacted_at from these.
insert into public.lead_activities (lead_id, actor_id, type, direction, body, occurred_at) values
  ('c0000001-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'call', 'out', 'Discussed floater options, explained diabetes waiting period',
   now() - interval '19 days'),
  ('c0000001-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'whatsapp', 'out', 'Sent the 10L floater quote', now() - interval '15 days'),
  ('c0000001-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'call', 'out', 'Closed. Policy issued.', now() - interval '40 days'),
  ('c0000001-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333',
   'meeting', 'out', 'Met at her clinic, walked through both proposals',
   now() - interval '5 days')
on conflict do nothing;

-- One converted policy, so source_performance and the premium totals are non-zero.
insert into public.policies (lead_id, insurer, product_name, policy_number, sum_assured,
                             premium, commission_pct, issue_date, renewal_date, created_by)
values ('c0000001-0000-0000-0000-000000000002', 'HDFC Ergo', 'Click 2 Protect Life',
        'POL-LOCAL-0001', 10000000, 14200, 12.5,
        (now() - interval '40 days')::date, (now() + interval '325 days')::date,
        '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- Lead 3 is deliberately left with no outbound activity and an assigned_at older than the
-- 24h threshold, so `select * from public.unattended_leads();` returns something as admin.
--
-- assigned_at is set explicitly on every lead above rather than left to the trigger. The
-- trigger honours a supplied value only for admins and profile-less contexts (seed.sql runs
-- as postgres, so it qualifies); without these values every backdated lead would be stamped
-- with today's date and the unattended fixture would silently stop demonstrating anything.
