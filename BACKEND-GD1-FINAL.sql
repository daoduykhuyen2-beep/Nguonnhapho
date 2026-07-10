-- ============================================================
-- NGUON NHA PHO HCM - BACKEND GIAI DOAN 1 (BAN FINAL - TONG HOP)
-- Chay 1 LAN tren Supabase project cua ban: SQL Editor -> New query -> dan -> Run
-- AN TOAN: chi THEM/BO SUNG, KHONG xoa bang cu (web_posts, posts...).
-- Idempotent: chay lai nhieu lan khong loi.
-- Khop CHINH XAC ten bang & cot ma index.html dang dung (web_posts + profiles).
-- Quy trinh: Dang ky/Dang nhap email -> Dang tin -> Hien cong khai ngay (khong bat buoc duyet)
--            + co san co che DUYET tuy chon cho admin.
-- ============================================================

-- =========================================================
-- 1) HO SO THANH VIEN (profiles) - khop dung ten cot code web dung
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists cover_url text;
alter table public.profiles add column if not exists membership_tier text default 'free';
alter table public.profiles add column if not exists membership_expires_at timestamptz;
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists age int;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles enable row level security;

-- Tu tao ho so khi dang ky (doc metadata full_name & phone dung nhu code gui len)
create or replace function public.tao_ho_so_moi()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name',''),
          new.email,
          coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tao_ho_so_moi();

-- Ham kiem tra admin (dung cho quyen duyet tin)
create or replace function public.la_admin()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_admin = true);
$$;

-- Quyen ho so: moi nguoi xem/sua ho so cua MINH; admin xem het
drop policy if exists "xem ho so minh" on public.profiles;
create policy "xem ho so minh" on public.profiles for select
  using (auth.uid() = id or public.la_admin());

drop policy if exists "sua ho so minh" on public.profiles;
create policy "sua ho so minh" on public.profiles for update
  using (auth.uid() = id);

-- =========================================================
-- 2) TIN DANG (web_posts) - DUNG ten & cot ma index.html doc/ghi
--    Code upsert theo client_id, nen client_id phai UNIQUE.
-- =========================================================
create table if not exists public.web_posts (
  id uuid primary key default gen_random_uuid(),
  client_id text unique not null,        -- id noi bo cua app (khoa upsert)
  owner_client text,                     -- id thanh vien phia app (chuoi)
  owner uuid references auth.users(id) on delete set null, -- gan voi auth (tuy chon)
  title text,
  loai text,
  quan text,
  phuong text,
  duong text,
  gia text,                              -- code gui dang String
  dien_tich text,                        -- code gui dang String
  contact_name text,
  contact_phone text,
  mota text,
  status text default 'thuong',          -- HANG tin (thuong/vang/kc...) - code dung field nay
  trang_thai text default 'duyet',       -- TRANG THAI duyet: duyet / cho_duyet / tu_choi
  created_local text,                    -- ngay tao phia app (chuoi)
  video text,
  anh jsonb default '{}'::jsonb,          -- object { imgs:[...], tin:{...} }
  created_at timestamptz default now()
);

-- Bo sung cot neu bang web_posts da ton tai tu truoc (an toan)
alter table public.web_posts add column if not exists client_id text;
alter table public.web_posts add column if not exists owner_client text;
alter table public.web_posts add column if not exists owner uuid references auth.users(id) on delete set null;
alter table public.web_posts add column if not exists title text;
alter table public.web_posts add column if not exists loai text;
alter table public.web_posts add column if not exists quan text;
alter table public.web_posts add column if not exists phuong text;
alter table public.web_posts add column if not exists duong text;
alter table public.web_posts add column if not exists gia text;
alter table public.web_posts add column if not exists dien_tich text;
alter table public.web_posts add column if not exists contact_name text;
alter table public.web_posts add column if not exists contact_phone text;
alter table public.web_posts add column if not exists mota text;
alter table public.web_posts add column if not exists status text default 'thuong';
alter table public.web_posts add column if not exists trang_thai text default 'duyet';
alter table public.web_posts add column if not exists created_local text;
alter table public.web_posts add column if not exists video text;
alter table public.web_posts add column if not exists anh jsonb default '{}'::jsonb;
alter table public.web_posts add column if not exists created_at timestamptz default now();

-- Dam bao client_id la UNIQUE (bat buoc de upsert onConflict:client_id chay)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'web_posts_client_id_key'
  ) then
    begin
      alter table public.web_posts add constraint web_posts_client_id_key unique (client_id);
    exception when others then null;
    end;
  end if;
end $$;

alter table public.web_posts enable row level security;
create index if not exists web_posts_created_idx on public.web_posts(created_at desc);
create index if not exists web_posts_tt_idx on public.web_posts(trang_thai, created_at desc);

-- RLS: app ghi bang client_id/owner_client (khong dung auth.uid), nen cho
-- nguoi DA DANG NHAP duoc ghi/sua tin. Moi nguoi xem tin da duyet; admin xem het.
drop policy if exists "dang tin" on public.web_posts;
create policy "dang tin" on public.web_posts for insert to authenticated
  with check (true);

drop policy if exists "sua tin" on public.web_posts;
create policy "sua tin" on public.web_posts for update to authenticated
  using (true);

drop policy if exists "xem tin" on public.web_posts;
create policy "xem tin" on public.web_posts for select
  using (trang_thai = 'duyet' or auth.uid() = owner or public.la_admin());

drop policy if exists "xoa tin" on public.web_posts;
create policy "xoa tin" on public.web_posts for delete to authenticated
  using (auth.uid() = owner or public.la_admin());

-- =========================================================
-- 3) KHO ANH (Storage) - bucket 'posts' + 'avatars' (dung ten code goi)
-- =========================================================
insert into storage.buckets (id, name, public)
values ('posts','posts',true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('avatars','avatars',true) on conflict (id) do nothing;

drop policy if exists "xem anh cong khai" on storage.objects;
create policy "xem anh cong khai" on storage.objects for select
  using (bucket_id in ('posts','avatars'));

drop policy if exists "tai anh len" on storage.objects;
create policy "tai anh len" on storage.objects for insert to authenticated
  with check (bucket_id in ('posts','avatars'));

drop policy if exists "sua anh minh" on storage.objects;
create policy "sua anh minh" on storage.objects for update to authenticated
  using (bucket_id in ('posts','avatars'));

-- ============================================================
-- XONG! Sau khi Run:
-- 1) Authentication -> Providers -> Email: BAT (mac dinh da bat).
--    (Tuy chon test nhanh) tat "Confirm email" de dang ky xong dang nhap luon.
-- 2) Mo web -> Dang ky 1 tai khoan bang email cua ban.
-- 3) Quay lai SQL Editor chay (thay email cua ban) de tu phong admin:
--      update public.profiles set is_admin = true where email = 'EMAIL_CUA_BAN';
--
-- GHI CHU QUY TRINH:
-- - Tin moi mac dinh trang_thai = 'duyet' => HIEN CONG KHAI NGAY (dung y ban: khong can duyet).
-- - Neu sau nay muon BAT duyet: doi default thanh 'cho_duyet':
--      alter table public.web_posts alter column trang_thai set default 'cho_duyet';
--   Khi do admin duyet bang:
--      update public.web_posts set trang_thai = 'duyet' where id = '...';
-- ============================================================
update public.profiles set is_admin = true where email = 'daoduykhuyen2@gmail.com';
