-- L3: capture audio is scoped to its owner's folder.
--
-- The old policy trusted storage.objects.owner, which is whoever uploaded the
-- file — any signed-in user could then read or overwrite any object in the
-- bucket by name. Capture audio now lives at `<user id>/<uuid>.<ext>` and the
-- policy requires the first folder to be the caller's own id. The bucket stays
-- private; the service role (transcription) is unaffected.

drop policy if exists captures_owner_all on storage.objects;

create policy captures_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
