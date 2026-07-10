-- ============================================================
-- NGUON NHA PHO HCM - BAN VA BAO MAT (HARDENED) cho web_posts + storage
-- Chay SAU khi da chay BACKEND-GD1-FINAL.sql
-- Muc dich: Va lo hong IDOR / Broken Access Control trong RLS.
-- An toan & idempotent. Giu web hien tai chay binh thuong.
-- ============================================================

-- ---------- 1) Tu gan chu so huu (owner = nguoi dang dang nhap) ----------
create or replace function public.wp_set_owner()
returns trigger language plpgsql security definer as $$
begin
  new.owner := auth.uid();
  if new.trang_thai is null then
    new.trang_thai := 'duyet';
  end if;
  return new;
end; $$;

drop trigger if exists wp_before_insert_owner on public.web_posts;
create trigger wp_before_insert_owner
  before insert on public.web_posts
  for each row execute function public.wp_set_owner();

create or replace function public.wp_keep_owner()
returns trigger language plpgsql security definer as $$
begin
  new.owner := old.owner;
  return new;
end; $$;

drop trigger if exists wp_before_update_owner on public.web_posts;
create trigger wp_before_update_owner
  before update on public.web_posts
  for each row execute function public.wp_keep_owner();

-- ---------- 2) VIET LAI RLS web_posts cho dung chuan ----------
drop policy if exists "dang tin" on public.web_posts;
create policy "dang tin" on public.web_posts for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "sua tin" on public.web_posts;
create policy "sua tin" on public.web_posts for update to authenticated
  using (auth.uid() = owner or public.la_admin())
  with check (auth.uid() = owner or public.la_admin());

drop policy if exists "xoa tin" on public.web_posts;
create policy "xoa tin" on public.web_posts for delete to authenticated
  using (auth.uid() = owner or public.la_admin());

drop policy if exists "xem tin" on public.web_posts;
create policy "xem tin" on public.web_posts for select
  using (trang_thai = 'duyet' or auth.uid() = owner or public.la_admin());

-- ---------- 3) VA quyen ho so (profiles) ----------
create or replace view public.profiles_public as
  select id, full_name, avatar_url, membership_tier, is_admin
  from public.profiles;
grant select on public.profiles_public to anon, authenticated;

drop policy if exists "xem ho so minh" on public.profiles;
create policy "xem ho so minh" on public.profiles for select
  using (auth.uid() = id or public.la_admin());

drop policy if exists "sua ho so minh" on public.profiles;
create policy "sua ho so minh" on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Chong tu nang quyen: nguoi dung KHONG duoc tu set is_admin / doi goi.
create or replace function public.profiles_block_priv_escalation()
returns trigger language plpgsql security definer as $$
begin
  if (new.is_admin is distinct from old.is_admin) and not public.la_admin() then
    new.is_admin := old.is_admin;
  end if;
  if (new.membership_tier is distinct from old.membership_tier) and not public.la_admin() then
    new.membership_tier := old.membership_tier;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_no_escalation on public.profiles;
create trigger profiles_no_escalation
  before update on public.profiles
  for each row execute function public.profiles_block_priv_escalation();

-- ---------- 4) VA Storage: chi cho sua/xoa file cua CHINH MINH ----------
drop policy if exists "tai anh len" on storage.objects;
create policy "tai anh len" on storage.objects for insert to authenticated
  with check (bucket_id in ('posts','avatars'));

drop policy if exists "sua anh minh" on storage.objects;
create policy "sua anh minh" on storage.objects for update to authenticated
  using (bucket_id in ('posts','avatars') and owner = auth.uid());

drop policy if exists "xoa anh minh" on storage.objects;
create policy "xoa anh minh" on storage.objects for delete to authenticated
  using (bucket_id in ('posts','avatars') and owner = auth.uid());

-- ============================================================
-- XONG BAN HARDENED.
-- Chu tin chi sua/xoa tin CUA MINH; admin sua het.
-- ============================================================
