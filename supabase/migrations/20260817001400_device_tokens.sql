-- 20260817001400_device_tokens.sql
--
-- FCM device tokens, for the push notifications in PLAN.md section 9's Phase 4 ("follow-up
-- reminders, new-lead-assigned alerts"). Section 2 already establishes the sending side:
-- pg_cron calling an Edge Function, which reads this table with the service role and so
-- bypasses RLS entirely.
--
-- ---------------------------------------------------------------------------
-- THE SHARED-DEVICE PROBLEM
-- ---------------------------------------------------------------------------
-- An FCM token identifies a *device installation*, not a person. On a field sales team that
-- distinction is not theoretical: a broker leaves, hands the company phone back, and the next
-- broker signs in on it. The token is unchanged.
--
-- If registration is a plain INSERT, that second broker's row collides with the first's and
-- the write fails -- so the device silently keeps pushing the *previous* broker's lead
-- assignments and follow-up reminders to whoever is now holding it. Client names and
-- follow-up details, on a phone belonging to someone who must not see them.
--
-- So registration goes through a SECURITY DEFINER function that *reassigns* the token to the
-- caller, deleting any prior claim on it. Presenting a token is proof of holding the device,
-- and the person holding the device is the person who should receive its notifications. This
-- is the one place where "last writer wins" is the secure answer rather than the lazy one.
-- ---------------------------------------------------------------------------

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- Unique across the whole table, not per profile: one physical device, one owner.
  token        text not null unique,
  platform     text not null check (platform in ('android', 'ios', 'web')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_tokens_profile_idx on public.device_tokens (profile_id);

alter table public.device_tokens enable row level security;

grant select, delete on public.device_tokens to authenticated;
-- No INSERT or UPDATE grant. Registration is only possible through register_device_token()
-- below, so the reassignment rule cannot be bypassed by writing the table directly.

-- A broker can see and revoke their own registrations (a "sign out everywhere" affordance),
-- and nobody else's. There is deliberately no admin read policy: the sender is an Edge
-- Function using the service role, so no human ever needs to read this table, and a token
-- list is a map of who can be reached on which device.
drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated
  using (profile_id = (select app_private.current_profile_id()));

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated
  using (profile_id = (select app_private.current_profile_id()));

create or replace function public.register_device_token(
  p_token    text,
  p_platform text
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

  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Unknown platform: %', p_platform using errcode = '22023';
  end if;

  -- FCM tokens are long opaque strings; the bound is a sanity check on a definer-function
  -- parameter, not a format assertion.
  if p_token is null or length(p_token) between 0 and 20 or length(p_token) > 4096 then
    raise exception 'Implausible device token' using errcode = '22023';
  end if;

  -- The reassignment. See the header: this is what stops a re-issued handset from delivering
  -- the previous broker's client data to the new one.
  insert into public.device_tokens (profile_id, token, platform)
  values (v_actor, p_token, p_platform)
  on conflict (token) do update
    set profile_id   = excluded.profile_id,
        platform     = excluded.platform,
        last_seen_at = now();
end;
$$;

comment on function public.register_device_token is
  'Claims an FCM token for the calling profile, taking it from any previous owner. The only writer of device_tokens.';

revoke all on function public.register_device_token(text, text) from public, anon;
grant execute on function public.register_device_token(text, text) to authenticated, service_role;
