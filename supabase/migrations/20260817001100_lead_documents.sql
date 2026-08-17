-- 20260817001100_lead_documents.sql
--
-- The Docs tab from PLAN.md section 5's wireframe (Details | Timeline | Docs), and the
-- "document storage" line from section 9's Phase 5.
--
-- This migration creates the *metadata index*. The files themselves live in Supabase
-- Storage, guarded separately in 20260817001200 -- and the two sets of policies have to
-- agree, because either one alone is a hole:
--
--   * metadata-only protection: the file is still fetchable by path from Storage.
--   * storage-only protection: the file is safe, but the listing leaks filenames, and a
--     filename on an insurance lead ("kolkata-diabetes-report.pdf") is itself health data
--     under the DPDP Act.
--
-- Why a metadata table at all, rather than just listing storage.objects: we need
-- `uploaded_by` as a profiles.id (storage.objects.owner is an auth.users id, a different
-- key), a `category`, and the original filename kept *out* of the storage path. See the
-- path-shape note in the next migration -- that separation is deliberate and it is the
-- reason this table exists.

create table if not exists public.lead_documents (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,

  -- '<lead_id>/<id>.<ext>'. Constrained below so a metadata row can never point at a file
  -- filed under a different lead.
  storage_path  text not null unique,

  -- The human filename, shown in the UI and used for the download. Deliberately NOT part
  -- of the storage path.
  file_name     text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),

  category      text check (category is null or category in
                  ('kyc', 'medical', 'quote', 'policy', 'claim', 'other')),

  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  -- Both sides of the path are checked: the folder must be this row's lead, and the file
  -- must be this row's id. Without this a broker could insert a metadata row pointing at
  -- another lead's file. That alone would not let them *read* it (the Storage SELECT policy
  -- re-derives the lead from the path independently), but it would surface the filename in
  -- a listing they are entitled to see -- which is the leak this table exists to prevent.
  constraint lead_documents_path_matches_lead_ck
    check (storage_path like lead_id::text || '/' || id::text || '.%')
);

create index if not exists lead_documents_lead_idx
  on public.lead_documents (lead_id, created_at desc);
create index if not exists lead_documents_uploader_idx
  on public.lead_documents (uploaded_by);

alter table public.lead_documents enable row level security;

grant select, insert, delete on public.lead_documents to authenticated;
-- No UPDATE grant. A document is the file that was uploaded; renaming or recategorising it
-- after the fact is not a workflow anyone asked for, and leaving it out means there is no
-- path by which storage_path can drift away from the object it names.

-- ---------------------------------------------------------------------------
-- Policies -- the same lead rules as everything else, via the shared predicates
-- ---------------------------------------------------------------------------
drop policy if exists lead_documents_select on public.lead_documents;
create policy lead_documents_select on public.lead_documents
  for select to authenticated
  using (app_private.can_read_lead(lead_id));

-- Uploading is a write on the lead: a read-only viewer in open mode cannot attach files to
-- someone else's client. `uploaded_by` is pinned to the caller so authorship cannot be
-- forged, matching lead_activities_insert.
drop policy if exists lead_documents_insert on public.lead_documents;
create policy lead_documents_insert on public.lead_documents
  for insert to authenticated
  with check (
    app_private.can_write_lead(lead_id)
    and uploaded_by = (select app_private.current_profile_id())
  );

-- Deletion is narrower than upload: the person who uploaded it, or an admin. A broker who
-- attaches the wrong file needs to remove it; a broker who can merely edit the lead does
-- not get to remove a colleague's evidence.
--
-- DPDP note (PLAN.md section 11): this is also the erasure path. Deleting the row does NOT
-- delete the stored file -- the client must delete the object through the Storage API as
-- well, and the trigger below records the intent either way so an incomplete deletion is
-- visible in the audit log rather than silent.
drop policy if exists lead_documents_delete on public.lead_documents;
create policy lead_documents_delete on public.lead_documents
  for delete to authenticated
  using (
    (select app_private.is_admin())
    or (
      uploaded_by = (select app_private.current_profile_id())
      and app_private.can_write_lead(lead_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Timeline + audit
-- ---------------------------------------------------------------------------
-- activity_type already has a 'document' value (Phase 1) -- it was defined for this.
create or replace function app_private.log_document_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, actor_id, type, body, occurred_at)
    values (new.lead_id, new.uploaded_by, 'document',
            format('Uploaded %s', new.file_name), now());
    return new;
  end if;

  -- Deletion of a client document is a DPDP-relevant event, so it lands in audit_log
  -- (append-only, admin-readable) as well as the lead's own timeline.
  insert into public.lead_activities (lead_id, actor_id, type, body, occurred_at)
  values (old.lead_id, (select app_private.current_profile_id()), 'document',
          format('Deleted %s', old.file_name), now());

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values ((select app_private.current_profile_id()), 'lead_documents', old.id::text, 'delete',
          jsonb_build_object(
            'lead_id', old.lead_id,
            'file_name', old.file_name,
            'storage_path', old.storage_path));

  return old;
end;
$$;

drop trigger if exists log_document_activity on public.lead_documents;
create trigger log_document_activity
  after insert or delete on public.lead_documents
  for each row execute function app_private.log_document_activity();
