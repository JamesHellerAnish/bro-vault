-- 20260817000200_core_tables.sql
-- Phase 1 / step 2: the tables from PLAN.md section 3.
--
-- RLS is enabled here on every table but no policies are created yet (that is step 4).
-- RLS-enabled-with-no-policies denies everything to non-superusers, so the window between
-- this migration and the policy migration is closed, not open.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- `id` is deliberately NOT `auth.users.id`. The admin pre-registers a broker by phone
-- number before that broker has ever logged in, so the profile must exist while
-- `auth_uid` is still null; it is linked on first successful OTP login. This is also
-- what makes deactivation clean -- the profile and all its history survive.
create table if not exists public.profiles (
  id               uuid primary key default gen_random_uuid(),
  auth_uid         uuid unique references auth.users (id) on delete set null,
  full_name        text not null check (length(btrim(full_name)) between 1 and 120),
  email            text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  phone            text not null unique check (phone ~ '^[+][1-9][0-9]{7,14}$'),  -- E.164
  whatsapp_number  text check (whatsapp_number is null or whatsapp_number ~ '^[+][1-9][0-9]{7,14}$'),
  role             public.user_role not null default 'broker',
  is_active        boolean not null default true,
  avatar_url       text,
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email)) where email is not null;
create index if not exists profiles_role_active_idx on public.profiles (role, is_active);

comment on column public.profiles.auth_uid is
  'Null until the broker completes their first phone-OTP login; linked by the auth.users trigger.';

-- ---------------------------------------------------------------------------
-- org_settings -- exactly one row, forever
-- ---------------------------------------------------------------------------
create table if not exists public.org_settings (
  id                       boolean primary key default true check (id),
  org_name                 text not null default 'MyInsuranceBro',
  lead_visibility          public.visibility_mode not null default 'assigned_only',
  -- In 'all' mode non-owners are read-only unless the admin also flips this.
  allow_cross_broker_edit  boolean not null default false,
  business_hours_start     time not null default '09:30',
  business_hours_end       time not null default '19:00',
  timezone                 text not null default 'Asia/Kolkata',
  -- A lead assigned this many hours ago with zero activity is "unattended" (PLAN.md section 7).
  unattended_lead_hours    integer not null default 24 check (unattended_lead_hours between 1 and 720),
  brand_color              text not null default '#1E4E9C',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

insert into public.org_settings (id) values (true) on conflict (id) do nothing;

comment on table public.org_settings is
  'Single-row org configuration. The check(id) on a boolean primary key makes a second row impossible.';

-- ---------------------------------------------------------------------------
-- Admin-editable vocabularies (PLAN.md section 3: "add or rename them from the admin
-- panel without a code change")
-- ---------------------------------------------------------------------------
create table if not exists public.traits (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null,
  category    public.trait_category not null,
  color       text not null default 'slate',
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.lead_sources (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.insurance_types (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label       text not null,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                     uuid primary key default gen_random_uuid(),
  full_name              text not null check (length(btrim(full_name)) between 1 and 160),
  phone                  text not null check (phone ~ '^[+][1-9][0-9]{7,14}$'),
  whatsapp_number        text check (whatsapp_number is null or whatsapp_number ~ '^[+][1-9][0-9]{7,14}$'),
  email                  text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),

  date_of_birth          date check (date_of_birth is null or date_of_birth > date '1900-01-01'),
  -- Kept alongside DOB because a broker on a call usually gets "42", not a birth date.
  age                    smallint check (age is null or age between 0 and 120),
  gender                 text check (gender is null or gender in ('male', 'female', 'other', 'undisclosed')),
  city                   text,
  state                  text,
  pincode                text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  occupation             text,
  annual_income_band     text,

  source_id              uuid references public.lead_sources (id) on delete set null,
  status                 public.lead_status not null default 'new',
  temperature            public.lead_temperature not null default 'warm',
  description            text,                       -- needs, wants, situation (free text)
  budget_expectation     numeric(12,2) check (budget_expectation is null or budget_expectation >= 0),
  existing_policies      text,
  preferred_language     text not null default 'en',
  preferred_contact_time text,

  -- DPDP Act 2023 (PLAN.md section 11): consent is captured at intake, not assumed.
  consent_given          boolean not null default false,
  consent_at             timestamptz,
  whatsapp_opt_in        boolean not null default false,

  assigned_to            uuid not null references public.profiles (id) on delete restrict,
  created_by             uuid references public.profiles (id) on delete set null,
  -- Per-lead override: hides a VIP/corporate case even while the org is in open mode.
  is_private             boolean not null default false,

  next_follow_up_at      timestamptz,
  first_contacted_at     timestamptz,
  converted_at           timestamptz,
  lost_at                timestamptz,
  lost_reason            text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint leads_consent_timestamp_ck
    check (consent_given = false or consent_at is not null)
);

-- Search: one generated tsvector so the leads list can do "type a name or a phone number"
-- without a separate index per column.
alter table public.leads
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(full_name, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(description, ''))
  ) stored;

create table if not exists public.lead_traits (
  lead_id     uuid not null references public.leads (id) on delete cascade,
  trait_id    uuid not null references public.traits (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (lead_id, trait_id)
);

create table if not exists public.lead_insurance_types (
  lead_id            uuid not null references public.leads (id) on delete cascade,
  insurance_type_id  uuid not null references public.insurance_types (id) on delete cascade,
  primary key (lead_id, insurance_type_id)
);

-- ---------------------------------------------------------------------------
-- Timeline and history
-- ---------------------------------------------------------------------------
create table if not exists public.lead_activities (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  type          public.activity_type not null,
  direction     public.activity_direction,
  channel_ref   text,                      -- wa message id, email message id, call log id
  template_id   uuid,                      -- FK added after templates exists, below
  body          text,
  outcome       text,
  -- True for section 6 Option A: we opened WhatsApp with a pre-filled message but cannot
  -- observe the send. The UI must render these differently from confirmed sends.
  is_optimistic boolean not null default false,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table if not exists public.lead_status_history (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  from_status public.lead_status,
  to_status   public.lead_status not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Converted business
-- ---------------------------------------------------------------------------
create table if not exists public.policies (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads (id) on delete restrict,
  insurer        text not null,
  product_name   text,
  policy_number  text,
  sum_assured    numeric(14,2) check (sum_assured is null or sum_assured >= 0),
  premium        numeric(12,2) check (premium is null or premium >= 0),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  issue_date     date,
  renewal_date   date,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint policies_renewal_after_issue_ck
    check (renewal_date is null or issue_date is null or renewal_date >= issue_date)
);

create unique index if not exists policies_policy_number_key
  on public.policies (policy_number) where policy_number is not null;

-- ---------------------------------------------------------------------------
-- Message templates (PLAN.md section 6: admin owns the library, brokers stay on-script)
-- ---------------------------------------------------------------------------
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  channel     public.template_channel not null,
  name        text not null,
  category    text,
  subject     text,                        -- email only
  body        text not null,
  variables   text[] not null default '{}',
  language    text not null default 'en',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint templates_email_needs_subject_ck
    check (channel <> 'email' or subject is not null)
);

create unique index if not exists templates_channel_name_lang_key
  on public.templates (channel, lower(name), language);

alter table public.lead_activities
  drop constraint if exists lead_activities_template_id_fkey;
alter table public.lead_activities
  add constraint lead_activities_template_id_fkey
  foreign key (template_id) references public.templates (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  entity     text not null,
  entity_id  text,
  action     text not null,
  diff       jsonb,
  at         timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. No policy grants update or delete to anyone, including admin (PLAN.md section 11).';

-- ---------------------------------------------------------------------------
-- Deny-by-default on everything that holds or shapes client data
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.org_settings         enable row level security;
alter table public.traits               enable row level security;
alter table public.lead_sources         enable row level security;
alter table public.insurance_types      enable row level security;
alter table public.leads                enable row level security;
alter table public.lead_traits          enable row level security;
alter table public.lead_insurance_types enable row level security;
alter table public.lead_activities      enable row level security;
alter table public.lead_status_history  enable row level security;
alter table public.policies             enable row level security;
alter table public.templates            enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_log            enable row level security;
