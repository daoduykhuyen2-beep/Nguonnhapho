-- ============================================================
-- NGUỒN NHÀ PHỐ HCM — BACKEND SẠCH (Giai đoạn 1: Sàn tin đăng)
-- Chạy 1 LẦN trên project Supabase MỚI: SQL Editor → New query → dán → Run
-- Thiết kế: 1 chuẩn duy nhất, bảo mật RLS chặt, mở rộng được.
-- ============================================================

-- =========================================================
-- 1) HỒ SƠ THÀNH VIÊN (gắn với đăng nhập Supabase Auth)
-- =========================================================
create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  ho_ten    text,
  sdt       text,
  email     text,
  avatar_url text,
  vai_tro   text default 'member',   -- member / broker / admin
  tao_luc   timestamptz default now()
);
alter table public.profiles enable row level security;

-- Tự động tạo hồ sơ ngay khi có thành viên mới đăng ký
create or replace function public.tao_ho_so_moi()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, ho_ten, email, sdt)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'ho_ten',''),
          new.email,
          coalesce(new.raw_user_meta_data->>'sdt',''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tao_ho_so_moi();

-- Hàm kiểm tra "có phải admin không" (dùng cho phân quyền)
create or replace function public.la_admin()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles
                where id = auth.uid() and vai_tro = 'admin');
$$;

-- Quyền trên hồ sơ
drop policy if exists "xem ho so" on public.profiles;
create policy "xem ho so" on public.profiles for select using (true);

drop policy if exists "sua ho so minh" on public.profiles;
create policy "sua ho so minh" on public.profiles for update
  using (auth.uid() = id);

-- =========================================================
-- 2) TIN ĐĂNG (bảng duy nhất — thay cho web_posts/posts cũ)
-- =========================================================
create table if not exists public.tin_dang (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references auth.users(id) on delete set null,
  tieu_de    text not null,
  loai       text,                       -- ban / thue
  hang       text default 'thuong',      -- thuong / vang / kc
  quan       text,
  phuong     text,
  duong      text,
  gia        numeric,                    -- tỷ đồng
  dien_tich  numeric,                    -- m2
  ngang      numeric,
  dai        numeric,
  tang       int,
  huong      text,
  phap_ly    text,
  vi_tri     text,                       -- Mặt tiền / Hẻm
  mo_ta      text,
  anh        jsonb default '[]'::jsonb,  -- danh sách URL ảnh
  video      text,
  contact_ten text,
  contact_sdt text,
  trang_thai text default 'cho_duyet',   -- cho_duyet / duyet / tu_choi
  luot_xem   int default 0,
  tao_luc    timestamptz default now()
);
alter table public.tin_dang enable row level security;
create index if not exists tin_dang_tt_idx on public.tin_dang(trang_thai, tao_luc desc);

-- Ai đã ĐĂNG NHẬP đều đăng tin được; tin mới BẮT BUỘC ở trạng thái chờ duyệt
drop policy if exists "dang tin" on public.tin_dang;
create policy "dang tin" on public.tin_dang for insert to authenticated
  with check (auth.uid() = owner and trang_thai = 'cho_duyet');

-- Ai cũng XEM tin đã duyệt; chủ tin xem tin của mình; admin xem hết
drop policy if exists "xem tin" on public.tin_dang;
create policy "xem tin" on public.tin_dang for select
  using (trang_thai = 'duyet' or auth.uid() = owner or public.la_admin());

-- Chủ tin sửa tin của mình; admin sửa mọi tin (để DUYỆT)
drop policy if exists "sua tin" on public.tin_dang;
create policy "sua tin" on public.tin_dang for update
  using (auth.uid() = owner or public.la_admin());

-- Chủ tin xóa tin của mình; admin xóa mọi tin
drop policy if exists "xoa tin" on public.tin_dang;
create policy "xoa tin" on public.tin_dang for delete
  using (auth.uid() = owner or public.la_admin());

-- =========================================================
-- 3) KHO ẢNH (Storage) — bucket ảnh tin + avatar, công khai đọc
-- =========================================================
insert into storage.buckets (id, name, public)
  values ('anh-tin','anh-tin',true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('avatars','avatars',true) on conflict (id) do nothing;

drop policy if exists "xem anh cong khai" on storage.objects;
create policy "xem anh cong khai" on storage.objects for select
  using (bucket_id in ('anh-tin','avatars'));

drop policy if exists "tai anh len" on storage.objects;
create policy "tai anh len" on storage.objects for insert to authenticated
  with check (bucket_id in ('anh-tin','avatars'));

-- ============================================================
-- XONG! Backend Giai đoạn 1 đã sẵn sàng.
-- Việc còn lại (làm ngoài SQL):
--   • Bật đăng nhập Email trong Authentication (mặc định đã bật).
--   • Sau khi TỰ đăng ký 1 tài khoản cho mình, chạy câu này để tự phong admin:
--       update public.profiles set vai_tro='admin' where email='EMAIL_CUA_ANH';
-- ============================================================
