-- 20260817001300_export_audit.sql
--
-- PLAN.md section 11: "Audit log for lead reassignment, status changes, exports, and
-- visibility-switch flips." Three of those four have been covered since Phase 1. Exports
-- were not, because until now nothing could export.
--
-- An export is the one action in this product that moves client PII *out* of the system
-- entirely -- past every RLS policy, into a spreadsheet on someone's laptop, beyond any
-- further control. Under the DPDP Act that is exactly the event a controller has to be able
-- to account for, so it is the one that most needs a record.
--
-- audit_log has no client INSERT policy by design (Phase 1: append-only, written only by
-- definer triggers). A client-initiated export has no trigger to hang off, so it needs this
-- function -- which makes it a SECURITY DEFINER write primitive into a tamper-proof,
-- admin-only table. That is worth constraining hard:
--
--   * the entity must be one of a known set, so this cannot become a write-anything channel
--   * the actor is taken from the session, never from a parameter
--   * the payload is shaped here, and its size is capped
--
-- Without those, any authenticated broker could stuff arbitrary jsonb into the audit trail
-- and turn the thing that is supposed to be evidence into a graffiti wall.

create or replace function public.log_export(
  p_entity    text,
  p_row_count integer,
  p_filters   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app_private.current_profile_id());
begin
  if v_actor is null then
    raise exception 'Not an active user' using errcode = '42501';
  end if;

  -- Allow-list, not a free string. Adding an export means adding it here deliberately.
  if p_entity not in ('leads', 'broker_leaderboard', 'source_performance', 'unattended_leads') then
    raise exception 'Unknown export entity: %', p_entity using errcode = '22023';
  end if;

  -- The filter description is for a human reading the log later, not a data channel.
  if length(coalesce(p_filters, '{}'::jsonb)::text) > 2000 then
    raise exception 'Export filter description is too large' using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor,
    p_entity,
    null,
    'export',
    jsonb_build_object(
      'row_count', greatest(coalesce(p_row_count, 0), 0),
      'filters',   coalesce(p_filters, '{}'::jsonb)
    )
  );
end;
$$;

comment on function public.log_export is
  'Records that rows left the system. The only client-callable writer of audit_log; entity is allow-listed and the actor comes from the session.';

-- Same posture as the metric functions: a SECURITY DEFINER function is executable by
-- everyone by default, and anon inherits from public.
revoke all on function public.log_export(text, integer, jsonb) from public, anon;
grant execute on function public.log_export(text, integer, jsonb) to authenticated, service_role;
