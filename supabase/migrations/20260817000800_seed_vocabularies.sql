-- 20260817000800_seed_vocabularies.sql
-- Phase 1 / step 8: the starting content for the admin-editable vocabularies and the
-- message template library.
--
-- This is a migration, not supabase/seed.sql, because production needs it too: the leads
-- form cannot render a trait picker or a source dropdown against empty tables. Everything
-- here is editable from the admin panel afterwards -- these are defaults, not constants.
--
-- All inserts are `on conflict (key) do nothing`, so re-running is safe and, more
-- importantly, a label the admin has since renamed is never silently reverted.

-- ---------------------------------------------------------------------------
-- Traits (PLAN.md section 3)
-- ---------------------------------------------------------------------------
insert into public.traits (key, label, category, color, sort_order) values
  -- Behavioural: where the lead's head is at
  ('somewhat_interested',   'Somewhat interested',        'behavioural', 'slate',  10),
  ('highly_interested',     'Highly interested',          'behavioural', 'green',  20),
  ('will_call_back',        'Will call back',             'behavioural', 'blue',   30),
  ('asked_to_call_later',   'Asked to call later',        'behavioural', 'blue',   40),
  ('price_sensitive',       'Price sensitive',            'behavioural', 'amber',  50),
  ('comparing_brokers',     'Comparing with other brokers','behavioural','amber',  60),
  ('needs_family_discussion','Needs family discussion',   'behavioural', 'slate',  70),
  ('just_enquiring',        'Just enquiring',             'behavioural', 'slate',  80),
  ('ready_to_buy',          'Ready to buy',               'behavioural', 'green',  90),

  -- Situational: facts about the case that change how it is worked
  ('documents_pending',     'Documents pending',          'situational', 'amber',  110),
  ('medical_test_required', 'Medical test required',      'situational', 'amber',  120),
  ('policy_expiring_soon',  'Existing policy expiring soon','situational','red',   130),
  ('renewal_case',          'Renewal case',               'situational', 'blue',   140),
  ('claim_support_needed',  'Claim support needed',       'situational', 'red',    150),
  ('nri',                   'NRI',                        'situational', 'violet', 160),
  ('senior_citizen',        'Senior citizen',             'situational', 'violet', 170),
  ('pre_existing_condition','Pre-existing condition',     'situational', 'red',    180),

  -- Operational: how to reach them, and when not to
  ('prefers_whatsapp',      'Prefers WhatsApp only',      'operational', 'green',  210),
  ('prefers_call',          'Prefers call',               'operational', 'blue',   220),
  ('lang_hindi',            'Language: Hindi',            'operational', 'slate',  230),
  ('lang_bengali',          'Language: Bengali',          'operational', 'slate',  240),
  ('lang_english',          'Language: English',          'operational', 'slate',  250),
  ('referral',              'Referral',                   'operational', 'green',  260),
  ('wrong_number',          'Wrong number',               'operational', 'red',    270),
  ('do_not_disturb',        'Do not disturb',             'operational', 'red',    280)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Lead sources (PLAN.md section 3)
-- ---------------------------------------------------------------------------
insert into public.lead_sources (key, label, sort_order) values
  ('referral',    'Referral',     10),
  ('facebook_ad', 'Facebook Ad',  20),
  ('google_ad',   'Google Ad',    30),
  ('website',     'Website form', 40),
  ('indiamart',   'IndiaMART',    50),
  ('walk_in',     'Walk-in',      60),
  ('cold_call',   'Cold call',    70),
  ('existing_client', 'Existing client', 80),
  ('other',       'Other',        999)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Insurance types
-- ---------------------------------------------------------------------------
insert into public.insurance_types (key, label, sort_order) values
  ('health',            'Health',            10),
  ('term_life',         'Term Life',         20),
  ('endowment',         'Endowment / Savings',30),
  ('motor',             'Motor',             40),
  ('travel',            'Travel',            50),
  ('home',              'Home',              60),
  ('personal_accident', 'Personal Accident', 70),
  ('group_corporate',   'Group / Corporate', 80)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Message templates (PLAN.md section 6)
-- ---------------------------------------------------------------------------
-- These back the WhatsApp deep link in Phase 2: the app fills the merge fields, encodes the
-- result and hands it to wa.me. The `variables` array is what the client validates against
-- before it builds the URL, so a template referencing a field the lead does not have fails
-- visibly in the composer instead of sending "Hello {{name}}" to a client.
--
-- Kept plain-text and short on purpose: WhatsApp renders no formatting in a pre-filled
-- message, and anything long gets truncated by the OS share sheet on some Android builds.
insert into public.templates (channel, name, category, subject, body, variables, language) values
  ('whatsapp', 'First greeting', 'greeting', null,
   'Namaste {{name}}, this is {{broker_name}} from {{org_name}}. Thank you for your interest in {{insurance_type}} insurance. When would be a good time for a short call?',
   array['name','broker_name','org_name','insurance_type'], 'en'),

  ('whatsapp', 'Quote follow-up', 'follow_up', null,
   'Hello {{name}}, following up on the {{insurance_type}} quote I shared. The premium works out to Rs {{premium}} per year for {{sum_assured}} cover. Happy to walk you through it whenever you are free.',
   array['name','insurance_type','premium','sum_assured'], 'en'),

  ('whatsapp', 'Document reminder', 'documents', null,
   'Hi {{name}}, we are just waiting on {{pending_documents}} to move your application forward. You can send a photo right here on WhatsApp if that is easier.',
   array['name','pending_documents'], 'en'),

  ('whatsapp', 'Renewal reminder', 'renewal', null,
   'Hi {{name}}, your {{insurer}} policy {{policy_number}} is due for renewal on {{renewal_date}}. Shall I check whether a better rate is available this year?',
   array['name','insurer','policy_number','renewal_date'], 'en'),

  ('whatsapp', 'Festival wish', 'relationship', null,
   'Wishing you and your family a very happy {{festival}}, {{name}}. Warm regards, {{broker_name}} - {{org_name}}.',
   array['name','festival','broker_name','org_name'], 'en'),

  ('whatsapp', 'First greeting', 'greeting', null,
   'Namaste {{name}}, main {{broker_name}}, {{org_name}} se. Aapki {{insurance_type}} insurance mein ruchi ke liye dhanyavaad. Baat karne ka sahi samay kya rahega?',
   array['name','broker_name','org_name','insurance_type'], 'hi'),

  ('whatsapp', 'Quote follow-up', 'follow_up', null,
   'Namaste {{name}}, jo {{insurance_type}} quote maine bheja tha uske baare mein. Premium Rs {{premium}} prati varsh hai, {{sum_assured}} ke cover ke liye. Koi bhi sawaal ho to bataaiye.',
   array['name','insurance_type','premium','sum_assured'], 'hi'),

  ('email', 'Quote shared', 'follow_up', 'Your {{insurance_type}} quote from {{org_name}}',
   'Dear {{name}},

Thank you for your time today. Please find below the {{insurance_type}} proposal we discussed:

  Insurer:      {{insurer}}
  Sum assured:  {{sum_assured}}
  Premium:      Rs {{premium}} per year

I have attached the full benefit illustration. Do let me know if you would like me to compare this against another insurer.

Warm regards,
{{broker_name}}
{{org_name}}',
   array['name','insurance_type','insurer','sum_assured','premium','broker_name','org_name'], 'en'),

  ('email', 'Renewal notice', 'renewal', 'Renewal due: {{insurer}} policy {{policy_number}}',
   'Dear {{name}},

Your {{insurer}} policy {{policy_number}} is due for renewal on {{renewal_date}}.

I will review the market before then and let you know if a better option is available. If you would like to renew as-is, simply reply to this email and I will take it forward.

Warm regards,
{{broker_name}}
{{org_name}}',
   array['name','insurer','policy_number','renewal_date','broker_name','org_name'], 'en')
on conflict do nothing;
