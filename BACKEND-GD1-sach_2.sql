-- ============================================================
-- NGUỒN NHÀ PHỐ HCM — BACKEND GĐ1 (AN TOÀN cho project đã có sẵn)
-- Chạy trên Supabase project HIỆN TẠI của anh: SQL Editor → dán → Run
-- Chỉ THÊM bảng sạch, KHÔNG xóa/đụng bảng cũ (web_posts, posts...).
-- ============================================================

-- ===== 1) HỒ SƠ THÀNH VIÊN — tạo nếu chưa có, bổ sung đủ cột =====
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

-- Tự tạo hồ sơ khi đăng ký (đọc metadata full_name & phone như code gửi lên)
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

-- Hàm kiểm tra admin
create or replace function public.la_admin()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_admin = true);
$$;

drop policy if exists "xem ho so minh" on public.profiles;
create policy "xem ho so minh" on public.profiles for select
  using (auth.uid() = id or public.la_admin());
drop policy if exists "sua ho so minh" on public.profiles;
create policy "sua ho so minh" on public.profiles for update
  using (auth.uid() = id);

-- ===== 2) TIN ĐĂNG — bảng sạch duy nhất =====
create table if not exists public.tin_dang (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid references auth.users(id) on delete set null,
  tieu_de     text not null,
  loai        text,
  hang        text default 'thuong',
  quan        text, phuong text, duong text,
  gia         numeric, dien_tich numeric, ngang numeric, dai numeric, tang int,
  huong       text, phap_ly text, vi_tri text,
  mo_ta       text,
  anh         jsonb default '[]'::jsonb,
  video       text,
  contact_ten text, contact_sdt text,
  trang_thai  text default 'cho_duyet',
  luot_xem    int default 0,
  tao_luc     timestamptz default now()
);
alter table public.tin_dang enable row level security;
create index if not exists tin_dang_tt_idx on public.tin_dang(trang_thai, tao_luc desc);

drop policy if exists "dang tin" on public.tin_dang;
create policy "dang tin" on public.tin_dang for insert to authenticated
  with check (auth.uid() = owner and trang_thai = 'cho_duyet');
drop policy if exists "xem tin" on public.tin_dang;
create policy "xem tin" on public.tin_dang for select
  using (trang_thai = 'duyet' or auth.uid() = owner or public.la_admin());
drop policy if exists "sua tin" on public.tin_dang;
create policy "sua tin" on public.tin_dang for update
  using (auth.uid() = owner or public.la_admin());
drop policy if exists "xoa tin" on public.tin_dang;
create policy "xoa tin" on public.tin_dang for delete
  using (auth.uid() = owner or public.la_admin());

-- ===== 3) KHO ẢNH (Storage) =====
insert into storage.buckets (id, name, public) values ('posts','posts',true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('avatars','avatars',true) on conflict (id) do nothing;
drop policy if exists "xem anh cong khai" on storage.objects;
create policy "xem anh cong khai" on storage.objects for select using (bucket_id in ('posts','avatars'));
drop policy if exists "tai anh len" on storage.objects;
create policy "tai anh len" on storage.objects for insert to authenticated with check (bucket_id in ('posts','avatars'));

-- ============================================================
-- XONG! Sau khi Run:
--  1) Mở web → Đăng ký 1 tài khoản bằng email của anh.
--  2) Quay lại đây chạy (thay email của anh):
--       update public.profiles set is_admin=true where email='EMAIL_CUA_ANH';
--  3) (Tùy chọn test nhanh) Authentication → Providers → Email → tắt "Confirm email".
-- ============================================================
