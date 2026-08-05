-- ============================================================================
-- BT Store Management — storage for asset photos and documents (#91 §2.2)
--
--   1. TWO BUCKETS, BECAUSE THE TWO KINDS OF FILE ARE NOT EQUALLY SENSITIVE.
--      A photo of a POS machine is not confidential, so `asset-images` is public
--      like `product-images` (0022) and its URL can be stored and rendered
--      directly. A purchase invoice or an AMC contract carries prices and vendor
--      terms, and this app revokes `cost_price` at the column level precisely to
--      keep that kind of figure from leaking — so `asset-docs` is PRIVATE. The
--      client stores the object PATH and asks for a short-lived signed URL when
--      someone actually opens the file.
--   2. READING A DOCUMENT STILL NEEDS A PERMISSION. Storage policies cannot call
--      has_perm() on a per-asset basis usefully, so the gate is: only
--      authenticated users can list or read `asset-docs` at all, and the paths
--      themselves live in `asset.documents`, which is behind the `assets.view`
--      RLS policy (0060). Someone with no asset access has no path to sign.
--   3. UPLOAD IS AUTHENTICATED, NOT ANONYMOUS, in both buckets — the same shape
--      0022 uses for product images.
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('asset-images', 'asset-images', true)
  on conflict (id) do nothing;

-- Private: no `public` flag, so every read goes through a signed URL (note 1).
insert into storage.buckets (id, name, public)
  values ('asset-docs', 'asset-docs', false)
  on conflict (id) do nothing;

-- ─── asset-images: public read, authenticated write ─────────────────────────
drop policy if exists "asset images are publicly readable" on storage.objects;
create policy "asset images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'asset-images');

drop policy if exists "authenticated can upload asset images" on storage.objects;
create policy "authenticated can upload asset images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'asset-images');

drop policy if exists "authenticated can update asset images" on storage.objects;
create policy "authenticated can update asset images"
  on storage.objects for update to authenticated
  using (bucket_id = 'asset-images');

drop policy if exists "authenticated can delete asset images" on storage.objects;
create policy "authenticated can delete asset images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'asset-images');

-- ─── asset-docs: authenticated only, in both directions (notes 1, 2) ────────
drop policy if exists "authenticated can read asset documents" on storage.objects;
create policy "authenticated can read asset documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'asset-docs');

drop policy if exists "authenticated can upload asset documents" on storage.objects;
create policy "authenticated can upload asset documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'asset-docs');

drop policy if exists "authenticated can delete asset documents" on storage.objects;
create policy "authenticated can delete asset documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'asset-docs');
