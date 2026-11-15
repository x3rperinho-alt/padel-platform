-- фото призов турниров: публичное чтение, загрузка/удаление — только редакторы лиги (первая папка пути = id лиги)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prizes', 'prizes', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "prizes_insert_editors" on storage.objects;
create policy "prizes_insert_editors" on storage.objects for insert to authenticated
  with check (bucket_id = 'prizes' and public.can_edit((storage.foldername(name))[1]));
drop policy if exists "prizes_update_editors" on storage.objects;
create policy "prizes_update_editors" on storage.objects for update to authenticated
  using (bucket_id = 'prizes' and public.can_edit((storage.foldername(name))[1]));
drop policy if exists "prizes_delete_editors" on storage.objects;
create policy "prizes_delete_editors" on storage.objects for delete to authenticated
  using (bucket_id = 'prizes' and public.can_edit((storage.foldername(name))[1]));
