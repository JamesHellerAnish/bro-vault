-- supabase/tests/documents_rls_test.sql
-- Run with: supabase test db      (needs the local stack up: supabase start)
--
-- Companion to rls_and_metrics_test.sql, for the two policy sets added in
-- 20260817001100 (public.lead_documents) and 20260817001200 (storage.objects).
--
-- These matter more than the lead-row tests, not less. A leaked lead row exposes a name and
-- a phone number to a colleague inside the same brokerage; a leaked object is a downloadable
-- medical report that can be forwarded outside it. And the storage half has a failure mode
-- the lead tables do not: its policies key off a *string path*, so they can be defeated by a
-- path the policy author did not imagine rather than by a role the policy author forgot.
-- Several assertions below are specifically about malformed and hostile paths.
--
-- Same harness as the other suite: become each role via request.jwt.claims and count.

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (as owner; RLS bypassed here by design)
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, phone, role, is_active) values
  ('00000000-0000-0000-0000-0000000000d1', 'Doc Admin',  '+919100000001', 'admin',  true),
  ('00000000-0000-0000-0000-0000000000d2', 'Doc Broker A', '+919100000002', 'broker', true),
  ('00000000-0000-0000-0000-0000000000d3', 'Doc Broker B', '+919100000003', 'broker', true);

insert into auth.users (instance_id, id, aud, role, phone, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1',
   'authenticated', 'authenticated', '919100000001', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2',
   'authenticated', 'authenticated', '919100000002', now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e3',
   'authenticated', 'authenticated', '919100000003', now(), now(), '{}'::jsonb, '{}'::jsonb);

-- f1 belongs to A, f2 to B, f3 to B and is private.
insert into public.leads (id, full_name, phone, assigned_to, created_by, is_private) values
  ('00000000-0000-0000-0000-0000000000f1', 'Doc Lead A', '+919812350001',
   '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2', false),
  ('00000000-0000-0000-0000-0000000000f2', 'Doc Lead B', '+919812350002',
   '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d3', false),
  ('00000000-0000-0000-0000-0000000000f3', 'Doc VIP B',  '+919812350003',
   '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d3', true);

insert into public.lead_documents (id, lead_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000a001.pdf',
   'A-kyc.pdf', 'application/pdf', 1024, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000a002.pdf',
   'B-medical-report.pdf', 'application/pdf', 2048, '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000000f3',
   '00000000-0000-0000-0000-0000000000f3/00000000-0000-0000-0000-00000000a003.pdf',
   'VIP-terms.pdf', 'application/pdf', 4096, '00000000-0000-0000-0000-0000000000d3');

-- Matching storage objects. `owner` is the auth.users id, which is what the delete policy
-- compares against.
insert into storage.objects (bucket_id, name, owner) values
  ('lead-documents',
   '00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000a001.pdf',
   '00000000-0000-0000-0000-0000000000e2'),
  ('lead-documents',
   '00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000a002.pdf',
   '00000000-0000-0000-0000-0000000000e3'),
  ('lead-documents',
   '00000000-0000-0000-0000-0000000000f3/00000000-0000-0000-0000-00000000a003.pdf',
   '00000000-0000-0000-0000-0000000000e3');

update public.org_settings set lead_visibility = 'assigned_only', allow_cross_broker_edit = false;

create or replace function pg_temp.become(p_auth_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', p_auth_uid, 'role', 'authenticated')::text);
end;
$$;

create or replace function pg_temp.become_anon() returns void
language plpgsql as $$
begin
  execute 'set local role anon';
  execute 'set local request.jwt.claims to ' || quote_literal('{"role":"anon"}');
end;
$$;

create or replace function pg_temp.become_owner() returns void
language plpgsql as $$
begin
  execute 'set local role postgres';
  execute 'set local request.jwt.claims to ' || quote_literal('null');
end;
$$;

-- ===========================================================================
-- 0. The bucket must be private. This is the assertion that protects all the others.
-- ===========================================================================
select pg_temp.become_owner();
select is(
  (select public from storage.buckets where id = 'lead-documents'),
  false,
  'the lead-documents bucket is private -- a public bucket bypasses every policy below'
);

-- ===========================================================================
-- 1. Path parsing -- the input the policies actually trust
-- ===========================================================================
select is(
  app_private.lead_id_from_storage_path(
    '00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000a001.pdf'),
  '00000000-0000-0000-0000-0000000000f1'::uuid,
  'a well-formed object path yields its lead id'
);
select is(app_private.lead_id_from_storage_path('not-a-uuid/secret.pdf'), null,
  'a non-uuid first segment yields null, not an error');
select is(app_private.lead_id_from_storage_path('secret.pdf'), null,
  'a path with no folder yields null');
select is(app_private.lead_id_from_storage_path(''), null, 'an empty path yields null');
select is(app_private.lead_id_from_storage_path(null), null, 'a null path yields null');
-- Traversal: the first segment is still not a uuid, so it denies for the ordinary reason.
select is(app_private.lead_id_from_storage_path('../' ||
    '00000000-0000-0000-0000-0000000000f2/x.pdf'), null,
  'a traversal-style prefix does not resolve to the lead it names');

-- The null must actually deny, not merely be null.
select is(app_private.can_read_lead(null), false,
  'can_read_lead(null) is false -- this is what makes an unparseable path fail closed');

-- ===========================================================================
-- 2. Closed mode: metadata
-- ===========================================================================
select pg_temp.become('00000000-0000-0000-0000-0000000000e2');   -- Broker A

select is((select count(*) from public.lead_documents), 1::bigint,
  'closed mode: broker A sees only their own lead''s documents');
select is((select count(*) from public.lead_documents
             where lead_id = '00000000-0000-0000-0000-0000000000f2'), 0::bigint,
  'closed mode: broker A cannot list broker B''s document metadata');
-- The filename is the leak that metadata-only protection would allow.
select is((select count(*) from public.lead_documents
             where file_name = 'B-medical-report.pdf'), 0::bigint,
  'closed mode: a colleague''s filename is not discoverable by searching for it');

-- ===========================================================================
-- 3. Closed mode: the objects themselves
-- ===========================================================================
select is((select count(*) from storage.objects where bucket_id = 'lead-documents'), 1::bigint,
  'closed mode: broker A sees only their own lead''s objects');
select is((select count(*) from storage.objects
             where name like '00000000-0000-0000-0000-0000000000f2/%'), 0::bigint,
  'closed mode: broker A cannot reach broker B''s object by its exact path');

select pg_temp.become_anon();
select is((select count(*) from storage.objects where bucket_id = 'lead-documents'), 0::bigint,
  'anon sees no objects: signed URLs are the only read path, and issuing one runs the policy');

-- ===========================================================================
-- 4. Open mode: readable, but private leads stay private
-- ===========================================================================
select pg_temp.become_owner();
update public.org_settings set lead_visibility = 'all';

select pg_temp.become('00000000-0000-0000-0000-0000000000e2');   -- Broker A

select is((select count(*) from public.lead_documents), 2::bigint,
  'open mode: broker A sees B''s ordinary document, but not the private lead''s');
select is((select count(*) from public.lead_documents
             where lead_id = '00000000-0000-0000-0000-0000000000f3'), 0::bigint,
  'open mode: is_private hides the document metadata too');
select is((select count(*) from storage.objects
             where name like '00000000-0000-0000-0000-0000000000f3/%'), 0::bigint,
  'open mode: is_private hides the object, not just its metadata row');

-- Open mode grants read, never write -- the same asymmetry as leads.
select throws_ok($$
  insert into public.lead_documents (id, lead_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values ('00000000-0000-0000-0000-00000000a009', '00000000-0000-0000-0000-0000000000f2',
          '00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000a009.pdf',
          'planted.pdf', 'application/pdf', 10, '00000000-0000-0000-0000-0000000000d2')
$$, '42501', null,
  'open mode: a non-owner cannot attach a document to someone else''s lead');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('lead-documents',
          '00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000a00a.pdf',
          '00000000-0000-0000-0000-0000000000e2')
$$, '42501', null,
  'open mode: a non-owner cannot upload an object into someone else''s lead folder');

select pg_temp.become_owner();
update public.org_settings set lead_visibility = 'assigned_only';

-- ===========================================================================
-- 5. Forgery and path-shape attacks
-- ===========================================================================
select pg_temp.become('00000000-0000-0000-0000-0000000000e2');   -- Broker A

select throws_ok($$
  insert into public.lead_documents (id, lead_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values ('00000000-0000-0000-0000-00000000a00b', '00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000a00b.pdf',
          'forged.pdf', 'application/pdf', 10, '00000000-0000-0000-0000-0000000000d3')
$$, '42501', null,
  'uploaded_by cannot be forged onto a colleague');

-- The path constraint, not a policy: a metadata row may not point outside its own lead,
-- which is what stops a readable listing from disclosing another lead's filenames.
select throws_ok($$
  insert into public.lead_documents (id, lead_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values ('00000000-0000-0000-0000-00000000a00c', '00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000a00c.pdf',
          'crosslinked.pdf', 'application/pdf', 10, '00000000-0000-0000-0000-0000000000d2')
$$, '23514', null,
  'a metadata row cannot point at a path under a different lead');

-- Uploading to a path that is not <uuid>/... denies, rather than erroring the statement.
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('lead-documents', 'no-lead-folder.pdf', '00000000-0000-0000-0000-0000000000e2')
$$, '42501', null,
  'an object with no lead folder is refused, not accepted into a nobody-owns-it path');

-- ===========================================================================
-- 6. Deletion is narrower than upload
-- ===========================================================================
-- A owns lead f1 and uploaded a001, so A may remove it.
select lives_ok($$
  delete from public.lead_documents where id = '00000000-0000-0000-0000-00000000a001'
$$, 'an uploader can delete their own document');

select is((select count(*) from public.lead_documents
             where id = '00000000-0000-0000-0000-00000000a001'), 0::bigint,
  'the delete actually removed the row');

-- Deletion is a DPDP-relevant event and must be recorded where it cannot be edited.
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');   -- admin
select isnt((select count(*) from public.audit_log
              where entity = 'lead_documents' and action = 'delete'), 0::bigint,
  'deleting a document writes an audit_log entry');

select pg_temp.become_owner();
select * from finish();
rollback;
