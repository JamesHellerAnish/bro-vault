-- 20260817000300_indexes.sql
-- Phase 1 / step 3: indexes.
--
-- These are chosen from the actual access patterns in PLAN.md sections 5, 7 and 8, not
-- speculatively. Two of them exist specifically because of RLS: every leads query a broker
-- runs carries an implicit `assigned_to = me`, so `assigned_to` leads the composite indexes.

-- The leads list, default sort (newest first), scoped to the caller.
create index if not exists leads_assigned_created_idx
  on public.leads (assigned_to, created_at desc);

-- Pill-tab filtering by pipeline stage within a broker's own list.
create index if not exists leads_assigned_status_idx
  on public.leads (assigned_to, status);

-- Open-mode list: admin and cross-broker browsing sort by recency across everyone.
create index if not exists leads_created_at_idx
  on public.leads (created_at desc);

-- Follow-ups screen: Today / Overdue / Upcoming. Partial, because a lead with no
-- scheduled follow-up is never on that screen and should not sit in the index.
create index if not exists leads_follow_up_idx
  on public.leads (assigned_to, next_follow_up_at)
  where next_follow_up_at is not null;

-- Conversion-time and funnel metrics filter on converted_at within a date window.
create index if not exists leads_converted_at_idx
  on public.leads (converted_at)
  where converted_at is not null;

-- Full-text search box on the leads list.
create index if not exists leads_search_tsv_idx
  on public.leads using gin (search_tsv);

-- "Type the last 4 digits of the phone number" -- tsvector cannot do infix matching,
-- trigram can.
create index if not exists leads_phone_trgm_idx
  on public.leads using gin (phone extensions.gin_trgm_ops);

create index if not exists leads_source_idx on public.leads (source_id);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_temperature_idx on public.leads (temperature);

-- Trait chips are a filter on the leads list, so the reverse direction matters as much
-- as the primary key ordering.
create index if not exists lead_traits_trait_idx on public.lead_traits (trait_id);
create index if not exists lead_insurance_types_type_idx
  on public.lead_insurance_types (insurance_type_id);

-- The lead detail Timeline tab: one lead, reverse chronological.
create index if not exists lead_activities_lead_occurred_idx
  on public.lead_activities (lead_id, occurred_at desc);

-- Activity-volume metrics and the unattended-lead alert scan by actor and by time.
create index if not exists lead_activities_actor_occurred_idx
  on public.lead_activities (actor_id, occurred_at desc);

create index if not exists lead_status_history_lead_idx
  on public.lead_status_history (lead_id, changed_at);

create index if not exists policies_lead_idx on public.policies (lead_id);
-- Renewal reminders (Phase 5) sweep a forward date window.
create index if not exists policies_renewal_idx
  on public.policies (renewal_date) where renewal_date is not null;

-- The nav badge asks one question: how many unread do I have.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);

create index if not exists templates_channel_active_idx
  on public.templates (channel, is_active, language);
