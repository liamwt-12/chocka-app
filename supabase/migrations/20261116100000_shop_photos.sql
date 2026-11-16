-- Photos of a shop's work (lib/shop-photos.ts).
--
-- A rep generates an upload link for one shop; the shop or the rep adds photos
-- through it; each photo is checked, has its metadata (including GPS position)
-- removed, and is stored in a PRIVATE bucket; nothing is used until a rep
-- approves it. Approved photos can be attached to posts.
--
-- ADDITIVE ONLY, with one widened constraint:
--   * new table shop_photos
--   * retailers: two nullable columns for the upload link (hash and expiry)
--   * scheduled_posts: one nullable column, the photo attached to a post
--   * change_log.action gains 'add_media' (a photo added to the listing itself,
--     which only happens when SHOP_PHOTOS_TO_LISTING=on)
--   * a private storage bucket, shop-photos
--
-- RLS is enabled with no policies and the public roles are revoked, matching
-- 20261115090000: only server code (the service role) can read or write.

create table if not exists public.shop_photos (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- CASCADE: when a shop's record is deleted (retention, or on request) its
  -- photo records go with it. The files are removed by the application.
  retailer_id         uuid not null references public.retailers(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id),

  -- Where the cleaned file is in the shop-photos bucket. Null once the file has
  -- been deleted (a rejected photo keeps its row, for the record, but no file).
  storage_path        text unique,
  content_type        text not null check (content_type in ('image/jpeg', 'image/png')),
  bytes               integer not null check (bytes > 0),
  width               integer not null check (width > 0),
  height              integer not null check (height > 0),

  -- pending: uploaded, not yet looked at. Only 'approved' is ever used.
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at         timestamptz,

  -- For choosing which photo goes on the next post.
  use_count           integer not null default 0,
  last_used_at        timestamptz,

  -- Set only if the photo was also added to the Google listing's own gallery.
  listing_media_name  text
);

create index if not exists shop_photos_retailer_status_idx on public.shop_photos (retailer_id, status);
create index if not exists shop_photos_tenant_idx on public.shop_photos (tenant_id);

alter table public.shop_photos enable row level security;
revoke all on table public.shop_photos from anon, authenticated;

-- The upload link. Only its hash is stored; generating a new link replaces it.
alter table public.retailers add column if not exists photo_link_hash text;
alter table public.retailers add column if not exists photo_link_expires_at timestamptz;
create unique index if not exists retailers_photo_link_hash_idx on public.retailers (photo_link_hash) where photo_link_hash is not null;

-- The photo attached to a post. SET NULL: deleting a photo leaves the post as text.
alter table public.scheduled_posts add column if not exists photo_id uuid references public.shop_photos(id) on delete set null;

-- change_log.action: allow 'add_media'.
alter table public.change_log drop constraint if exists change_log_action_check;
alter table public.change_log add constraint change_log_action_check
  check (action in ('update_location', 'create_post', 'reply_review', 'add_media'));

-- The bucket. Private: files are only ever reached through short-lived signed
-- addresses made by server code. The size and type limits repeat what the
-- application enforces, as a second line of defence.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', false, 4194304, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
