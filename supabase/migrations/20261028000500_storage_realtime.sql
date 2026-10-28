-- =============================================================================
-- 0500 — Attachment storage and Realtime
-- =============================================================================

-- Private bucket: files are never publicly addressable; the app requests
-- short-lived signed URLs, which Storage only issues if the SELECT policy
-- below passes for the requesting user. 10 MB hard limit per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'application/pdf', 'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object path layout: <conversation_id>/<uploader_user_id>/<random>-<filename>

-- Upload: active member of the conversation, into their own folder, while
-- attachments are enabled.
create policy "attachments: members upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and (select attachments_enabled from public.app_settings)
    and private.is_conversation_member(private.try_uuid(split_part(name, '/', 1)))
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

-- Download: active member of the conversation, and either the file is attached
-- to a message, or it is the uploader's own pending upload.
create policy "attachments: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and private.is_conversation_member(private.try_uuid(split_part(name, '/', 1)))
    and (
      exists (select 1 from public.attachments a where a.storage_path = name)
      or split_part(name, '/', 2) = (select auth.uid())::text
    )
  );

-- Delete: uploaders remove their own files (used after deleting a message).
create policy "attachments: uploader deletes own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.is_active_user())
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

-- No UPDATE policy: files cannot be overwritten after upload.

-- -----------------------------------------------------------------------------
-- Realtime (Postgres Changes). Realtime evaluates the table's SELECT RLS
-- policy for every subscriber on every change, so users only receive events
-- for conversations they belong to, and a revoked user stops receiving
-- events immediately.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversation_members;
  end if;
end;
$$;
