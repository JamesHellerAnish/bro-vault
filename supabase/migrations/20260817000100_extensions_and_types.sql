-- 20260817000100_extensions_and_types.sql
-- Phase 1 / step 1: extensions, private helper schema, and the enum vocabulary.
--
-- Enums (not lookup tables) are used where the set is part of the application's logic:
-- pipeline code branches on status, RLS branches on role. Adding a value there is a code
-- change anyway. Sets the admin must be able to edit at runtime -- traits, sources,
-- insurance types -- are lookup tables instead (see 20260817000200).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- Helper schema. PostgREST exposes only `public`, so nothing in here is reachable from a
-- client, by design: these functions are the inputs to the security policies themselves.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to postgres, service_role;

do $$ begin
  create type public.user_role as enum ('admin', 'broker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum (
    'new',
    'contacted',
    'interested',
    'quote_shared',
    'negotiation',      -- "Negotiation / Docs Pending"
    'converted',
    -- terminal off-ramps
    'not_reachable',
    'lost',
    'do_not_contact'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_temperature as enum ('hot', 'warm', 'cold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_type as enum (
    'call', 'whatsapp', 'email', 'meeting', 'note', 'status_change', 'assignment', 'document'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.visibility_mode as enum ('all', 'assigned_only');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.template_channel as enum ('whatsapp', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trait_category as enum ('behavioural', 'situational', 'operational');
exception when duplicate_object then null; end $$;

-- Which statuses count as "the lead is still live". Used by metrics and by the
-- unattended-lead alert so the definition never drifts between them.
create or replace function public.is_open_status(p_status public.lead_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in ('new', 'contacted', 'interested', 'quote_shared', 'negotiation')
$$;

comment on function public.is_open_status is
  'True while a lead is still working its way down the pipeline (not converted, not off-ramped).';
