-- 20260817001200_storage_documents.sql
--
-- The files themselves. This is the highest-blast-radius file in the repo: the objects it
-- guards are clients' KYC scans, medical reports and signed policy documents, and unlike a
-- leaked lead row they can be forwarded, cached and indexed once a URL escapes.
--
-- Three decisions carry the security here, in order of how badly each fails:
--
--   1. THE BUCKET IS PRIVATE. `public = false` below is the single most important token in
--      this migration. A public bucket serves every object at a stable, guessable-by-listing
--      URL with NO policy evaluation at all -- RLS on storage.objects is simply not consulted
--      for public reads. Every policy in this file would still exist, still look correct in
--      review, and protect nothing. Reads go through short-lived signed URLs instead
--      (createSignedUrl), and issuing one runs the SELECT policy below.
--
--   2. THE LEAD IS DERIVED FROM THE PATH, NOT FROM THE REQUEST. storage.objects has no
--      lead_id column and we cannot add one, so the first path segment IS the lead id and
--      the policies re-derive it on every access. That is why the path shape is constrained
--      on the metadata table too -- both sides agree on the same convention independently.
--
--   3. THE PATH CARRIES NO FILENAME. Objects are '<lead_id>/<document_id>.<ext>', never
--      '<lead_id>/medical-report-diabetes.pdf'. A signed URL is a bearer token that gets
--      pasted into chats and written to server logs; a path of two UUIDs discloses nothing
--      if it leaks, while a descriptive filename discloses health information about a named
--      person. The human filename lives in public.lead_documents.file_name and is applied
--      at download time.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-documents',
  'lead-documents',
  false,                       -- see note 1. Never flip this.
  10485760,                    -- 10 MB: a phone photo of a policy document, with headroom
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public             = false,   -- re-assert on re-run: this must never drift to true
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Deriving the lead from an object path, safely
-- ---------------------------------------------------------------------------
-- Returns null for anything that is not '<uuid>/...'. Null then flows into
-- can_read_lead(null), which coalesces to false (Phase 1) -- so a malformed or hand-crafted
-- path denies rather than errors.
--
-- The regex guard is load-bearing: a bare `split_part(name,'/',1)::uuid` raises 22P02 on a
-- path like 'foo/bar.pdf'. Inside a policy that aborts the whole statement instead of
-- filtering the row -- it happens to fail closed, but it turns an ordinary listing of a
-- mixed bucket into an error, and error-vs-empty is exactly the kind of difference that
-- gets "fixed" later by loosening the policy.
create or replace function app_private.lead_id_from_storage_path(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(coalesce(p_name, ''), '/', 1) ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end
$$;

comment on function app_private.lead_id_from_storage_path is
  'First path segment as a lead id, or null if the path is not <uuid>/... . Null denies via can_read_lead(null) = false.';

grant execute on function app_private.lead_id_from_storage_path(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects
-- ---------------------------------------------------------------------------
-- Every policy is scoped `to authenticated` AND filtered on bucket_id. The bucket filter is
-- not redundant: storage.objects holds every bucket in the project, so a policy without it
-- would grant its access across all of them, including buckets added years from now by
-- someone who never read this file.

drop policy if exists lead_documents_object_select on storage.objects;
create policy lead_documents_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lead-documents'
    and app_private.can_read_lead(app_private.lead_id_from_storage_path(name))
  );

drop policy if exists lead_documents_object_insert on storage.objects;
create policy lead_documents_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lead-documents'
    and app_private.can_write_lead(app_private.lead_id_from_storage_path(name))
  );

-- UPDATE exists because the Storage API's upsert path issues one, and because a policy-less
-- UPDATE would let a writer on lead A rename an object into lead B's folder -- moving a file
-- across the visibility boundary without ever reading it. USING checks where it is now,
-- WITH CHECK checks where it is going; both must pass, so a move is only possible between
-- two leads the caller may already write.
drop policy if exists lead_documents_object_update on storage.objects;
create policy lead_documents_object_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'lead-documents'
    and app_private.can_write_lead(app_private.lead_id_from_storage_path(name))
  )
  with check (
    bucket_id = 'lead-documents'
    and app_private.can_write_lead(app_private.lead_id_from_storage_path(name))
  );

-- Mirrors lead_documents_delete on the metadata table: uploader or admin, never merely
-- "someone who can edit the lead". `owner` is the auth.users id of the uploader, which is
-- why this compares against auth.uid() rather than a profile id.
drop policy if exists lead_documents_object_delete on storage.objects;
create policy lead_documents_object_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'lead-documents'
    and (
      (select app_private.is_admin())
      or (
        owner = (select auth.uid())
        and app_private.can_write_lead(app_private.lead_id_from_storage_path(name))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Known gap, recorded rather than papered over
-- ---------------------------------------------------------------------------
-- Deleting a lead cascades public.lead_documents (on delete cascade) but does NOT remove the
-- objects from Storage: the files sit in the bucket with no metadata row, unreachable
-- through the app but still billed and still present.
--
-- This is not fixable from SQL. Deleting a row from storage.objects unlinks it from the
-- listing without removing the underlying S3 object, so a trigger here would replace a
-- visible orphan with an invisible one -- strictly worse, because the invisible one cannot
-- be swept afterwards.
--
-- The real fix is an Edge Function on lead deletion (or a scheduled sweep via pg_cron, which
-- PLAN.md section 2 already establishes as this project's scheduler) that calls the Storage
-- API properly. Until that exists, admin lead-deletion leaves orphaned files. It is admin-only
-- and rare, and the alternative -- brokers deleting leads -- is not on the table.
