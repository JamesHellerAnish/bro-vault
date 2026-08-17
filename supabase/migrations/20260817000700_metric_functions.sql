-- 20260817000700_metric_functions.sql
-- Phase 1 / step 7: dashboard metrics. PLAN.md section 7.
--
-- These are SECURITY DEFINER, which means they read past RLS by design: an org-wide
-- leaderboard has to aggregate rows the caller cannot select individually. That makes each
-- one an API endpoint in its own right, so each one re-establishes the caller's rights
-- itself. Two rules, applied without exception:
--
--   * A broker's scope is *clamped*, not validated. `app_private.resolve_metric_scope` is
--     the only place a broker_id parameter is interpreted, and for a non-admin it returns
--     the caller's own id no matter what was passed. PLAN.md section 7: "a broker calling
--     the org-metrics function gets back only their own slice, no matter what the client
--     asks for."
--
--   * Functions that are inherently org-wide (leaderboard, source performance, unattended
--     leads) raise for a non-admin rather than clamping. Clamping a leaderboard to one row
--     would be a confusing half-answer; refusing is honest.
--
-- Definitions are shared with the rest of the schema rather than restated: "still open" is
-- public.is_open_status, "unattended" reads its threshold from org_settings.

-- ---------------------------------------------------------------------------
-- The clamp
-- ---------------------------------------------------------------------------
create or replace function app_private.resolve_metric_scope(p_broker_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select app_private.current_profile_id());
begin
  if v_me is null then
    raise exception 'Not an active user' using errcode = '42501';
  end if;

  if (select app_private.is_admin()) then
    -- null means org-wide, which only an admin may ask for.
    return p_broker_id;
  end if;

  return v_me;
end;
$$;

create or replace function app_private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app_private.is_admin()) then
    raise exception 'Admin only' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who am I (the client calls this once on boot)
-- ---------------------------------------------------------------------------
create or replace function public.me()
returns table (
  id uuid, full_name text, email text, phone text, whatsapp_number text,
  role public.user_role, is_active boolean, avatar_url text, joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email, p.phone, p.whatsapp_number,
         p.role, p.is_active, p.avatar_url, p.joined_at
  from public.profiles p
  where p.auth_uid = (select auth.uid())
    and p.is_active
$$;

-- ---------------------------------------------------------------------------
-- Broker dashboard (PLAN.md section 7, first block)
-- ---------------------------------------------------------------------------
-- An admin may pass a broker id to inspect one person, or null for the whole org. A broker
-- gets their own numbers whatever they pass.
create or replace function public.broker_metrics(
  p_broker_id uuid default null,
  p_from      timestamptz default (now() - interval '30 days'),
  p_to        timestamptz default now()
)
returns table (
  leads_received              bigint,
  leads_contacted             bigint,
  leads_converted             bigint,
  leads_lost                  bigint,
  leads_open                  bigint,
  conversion_rate             numeric,
  prev_conversion_rate        numeric,
  avg_conversion_hours        numeric,
  avg_first_contact_hours     numeric,
  activities_logged           bigint,
  follow_ups_due_today        bigint,
  follow_ups_overdue          bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope     uuid := app_private.resolve_metric_scope(p_broker_id);
  -- The comparison window is the same length, immediately before this one.
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_tz        text := (select timezone from public.org_settings where id);
begin
  return query
  with scoped as (
    select l.*
    from public.leads l
    where v_scope is null or l.assigned_to = v_scope
  ),
  window_leads as (
    select * from scoped where created_at >= p_from and created_at < p_to
  ),
  prev_leads as (
    select * from scoped where created_at >= v_prev_from and created_at < p_from
  )
  select
    (select count(*) from window_leads),
    (select count(*) from scoped
      where first_contacted_at >= p_from and first_contacted_at < p_to),
    (select count(*) from scoped
      where converted_at >= p_from and converted_at < p_to),
    (select count(*) from scoped
      where lost_at >= p_from and lost_at < p_to),
    (select count(*) from scoped where public.is_open_status(status)),

    -- Cohort conversion: of the leads received in this window, how many have converted.
    -- Not "conversions this window / leads this window", which mixes two populations and
    -- can exceed 100% in a month where old leads close.
    (select case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where converted_at is not null) / count(*), 1)
            end
       from window_leads),
    (select case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where converted_at is not null) / count(*), 1)
            end
       from prev_leads),

    (select round(avg(extract(epoch from (converted_at - created_at)) / 3600.0)::numeric, 1)
       from scoped where converted_at >= p_from and converted_at < p_to),
    (select round(avg(extract(epoch from (first_contacted_at - created_at)) / 3600.0)::numeric, 1)
       from scoped where first_contacted_at >= p_from and first_contacted_at < p_to),

    (select count(*)
       from public.lead_activities a
       where a.occurred_at >= p_from and a.occurred_at < p_to
         and (v_scope is null or a.actor_id = v_scope)
         and a.type in ('call', 'whatsapp', 'email', 'meeting', 'note')),

    -- "Today" is the org's calendar day (Asia/Kolkata by default), not the server's.
    (select count(*) from scoped
      where public.is_open_status(status)
        and (next_follow_up_at at time zone v_tz)::date = (now() at time zone v_tz)::date),
    (select count(*) from scoped
      where public.is_open_status(status)
        and (next_follow_up_at at time zone v_tz)::date < (now() at time zone v_tz)::date);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pipeline funnel
-- ---------------------------------------------------------------------------
create or replace function public.pipeline_funnel(
  p_broker_id uuid default null,
  p_from      timestamptz default (now() - interval '30 days'),
  p_to        timestamptz default now()
)
returns table (status public.lead_status, lead_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid := app_private.resolve_metric_scope(p_broker_id);
begin
  return query
  -- Left join off the enum so empty stages come back as 0 instead of disappearing; a funnel
  -- chart with a missing bar reads as "no such stage", not "nobody is there".
  select s.status, count(l.id)
  from (select unnest(enum_range(null::public.lead_status)) as status) s
  left join public.leads l
    on l.status = s.status
   and (v_scope is null or l.assigned_to = v_scope)
   and l.created_at >= p_from and l.created_at < p_to
  group by s.status
  order by array_position(enum_range(null::public.lead_status), s.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversion trend, for the line chart
-- ---------------------------------------------------------------------------
create or replace function public.conversion_trend(
  p_broker_id uuid default null,
  p_from      timestamptz default (now() - interval '90 days'),
  p_to        timestamptz default now(),
  p_bucket    text default 'week'
)
returns table (bucket_start date, leads_received bigint, leads_converted bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid := app_private.resolve_metric_scope(p_broker_id);
  v_tz    text := (select timezone from public.org_settings where id);
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'p_bucket must be day, week or month' using errcode = '22023';
  end if;

  return query
  with buckets as (
    select generate_series(
             date_trunc(p_bucket, p_from at time zone v_tz),
             date_trunc(p_bucket, p_to   at time zone v_tz),
             ('1 ' || p_bucket)::interval) as b
  ),
  scoped as (
    select l.created_at, l.converted_at
    from public.leads l
    where v_scope is null or l.assigned_to = v_scope
  )
  select b::date,
         (select count(*) from scoped s
           where date_trunc(p_bucket, s.created_at at time zone v_tz) = b),
         (select count(*) from scoped s
           where s.converted_at is not null
             and date_trunc(p_bucket, s.converted_at at time zone v_tz) = b)
  from buckets
  order by b;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity mix -- effort against outcome
-- ---------------------------------------------------------------------------
create or replace function public.activity_summary(
  p_broker_id uuid default null,
  p_from      timestamptz default (now() - interval '30 days'),
  p_to        timestamptz default now()
)
returns table (type public.activity_type, activity_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid := app_private.resolve_metric_scope(p_broker_id);
begin
  return query
  select a.type, count(*)
  from public.lead_activities a
  where a.occurred_at >= p_from and a.occurred_at < p_to
    and (v_scope is null or a.actor_id = v_scope)
    and a.type in ('call', 'whatsapp', 'email', 'meeting', 'note')
  group by a.type
  order by count(*) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin only from here down
-- ---------------------------------------------------------------------------

-- Per-broker leaderboard (PLAN.md section 7, second block)
create or replace function public.broker_leaderboard(
  p_from timestamptz default (now() - interval '30 days'),
  p_to   timestamptz default now()
)
returns table (
  broker_id               uuid,
  full_name               text,
  avatar_url              text,
  leads_handled           bigint,
  leads_converted         bigint,
  conversion_rate         numeric,
  avg_conversion_hours    numeric,
  avg_first_contact_hours numeric,
  activities_logged       bigint,
  open_leads              bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();

  return query
  select
    p.id,
    p.full_name,
    p.avatar_url,
    count(l.id) filter (where l.created_at >= p_from and l.created_at < p_to),
    count(l.id) filter (where l.converted_at >= p_from and l.converted_at < p_to),
    case
      when count(l.id) filter (where l.created_at >= p_from and l.created_at < p_to) = 0 then 0
      else round(100.0
        * count(l.id) filter (where l.created_at >= p_from and l.created_at < p_to
                                and l.converted_at is not null)
        / count(l.id) filter (where l.created_at >= p_from and l.created_at < p_to), 1)
    end,
    round(avg(extract(epoch from (l.converted_at - l.created_at)) / 3600.0)
            filter (where l.converted_at >= p_from and l.converted_at < p_to)::numeric, 1),
    round(avg(extract(epoch from (l.first_contacted_at - l.created_at)) / 3600.0)
            filter (where l.first_contacted_at >= p_from and l.first_contacted_at < p_to)::numeric, 1),
    (select count(*) from public.lead_activities a
      where a.actor_id = p.id
        and a.occurred_at >= p_from and a.occurred_at < p_to
        and a.type in ('call', 'whatsapp', 'email', 'meeting', 'note')),
    count(l.id) filter (where public.is_open_status(l.status))
  from public.profiles p
  left join public.leads l on l.assigned_to = p.id
  where p.role = 'broker' and p.is_active
  group by p.id, p.full_name, p.avatar_url
  -- Conversion rate first, then volume. Never by avg_conversion_hours, where lower is better.
  order by 6 desc, 5 desc;
end;
$$;

-- Which channel actually converts
create or replace function public.source_performance(
  p_from timestamptz default (now() - interval '90 days'),
  p_to   timestamptz default now()
)
returns table (
  source_id       uuid,
  source_label    text,
  leads_received  bigint,
  leads_converted bigint,
  conversion_rate numeric,
  total_premium   numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();

  return query
  -- count(distinct l.id), not count(l.id): a lead with two issued policies joins twice, and
  -- a plain count would report it as two leads from that source.
  select
    s.id,
    coalesce(s.label, 'Unknown'),
    count(distinct l.id),
    count(distinct l.id) filter (where l.converted_at is not null),
    case when count(distinct l.id) = 0 then 0
         else round(100.0 * count(distinct l.id) filter (where l.converted_at is not null)
                    / count(distinct l.id), 1)
    end,
    coalesce(sum(po.premium), 0)
  from public.leads l
  left join public.lead_sources s on s.id = l.source_id
  left join public.policies po on po.lead_id = l.id
  where l.created_at >= p_from and l.created_at < p_to
  group by s.id, s.label
  order by 4 desc, 3 desc;
end;
$$;

-- Assigned a while ago, still no activity at all (PLAN.md section 7).
create or replace function public.unattended_leads(p_limit integer default 100)
returns table (
  lead_id       uuid,
  full_name     text,
  phone         text,
  status        public.lead_status,
  temperature   public.lead_temperature,
  assigned_to   uuid,
  broker_name   text,
  created_at    timestamptz,
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
         round(extract(epoch from (now() - l.created_at)) / 3600.0, 1)
  from public.leads l
  join public.profiles p on p.id = l.assigned_to
  where public.is_open_status(l.status)
    and l.created_at < now() - make_interval(hours => v_hours)
    and not exists (
      select 1 from public.lead_activities a
      where a.lead_id = l.id
        and a.type in ('call', 'whatsapp', 'email', 'meeting')
    )
  order by l.created_at
  limit greatest(p_limit, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution rights
-- ---------------------------------------------------------------------------
-- `revoke from public` first: a SECURITY DEFINER function is executable by everyone by
-- default, and `anon` inherits from public. Without this, the leaderboard would be
-- reachable by an unauthenticated caller -- who would then hit require_admin() and be
-- refused, but the endpoint should not exist for them at all.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.me()',
    'public.broker_metrics(uuid, timestamptz, timestamptz)',
    'public.pipeline_funnel(uuid, timestamptz, timestamptz)',
    'public.conversion_trend(uuid, timestamptz, timestamptz, text)',
    'public.activity_summary(uuid, timestamptz, timestamptz)',
    'public.broker_leaderboard(timestamptz, timestamptz)',
    'public.source_performance(timestamptz, timestamptz)',
    'public.unattended_leads(integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
