-- ============================================================
-- مؤسسة أبرار الخير — مخطط Supabase
-- التنفيذ: الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run
-- ============================================================

-- 1) جدول طلبات الكفالة
create table if not exists public.requests (
  id bigserial primary key,
  orphan_name text not null,
  orphan_id text not null unique,
  orphan_birth date not null,
  orphan_gender text,
  guardian_name text not null,
  guardian_id text not null,
  guardian_birth date,
  guardian_rel text,
  father_name text,
  father_id text,
  death_date date,
  death_cause text,
  original_address text,
  displacement_address text,
  phone_primary text not null,
  phone_alt text,
  health_status text,
  health_note text,
  status text not null default 'pending',  -- pending | approved | rejected
  created_at timestamptz not null default now()
);
create index if not exists idx_requests_status on public.requests (status);
create index if not exists idx_requests_created on public.requests (created_at desc);

-- 2) جدول المشاريع (صور السلايدر داخل images كـ JSON)
create table if not exists public.projects (
  id text primary key,
  name text not null,
  description text default '',
  images jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 3) تفعيل RLS + السياسات
alter table public.requests enable row level security;
alter table public.projects enable row level security;

drop policy if exists "public_insert_requests" on public.requests;
create policy "public_insert_requests" on public.requests
  for insert to anon, authenticated with check (true);

drop policy if exists "admin_all_requests" on public.requests;
create policy "admin_all_requests" on public.requests
  for all to authenticated using (true) with check (true);

drop policy if exists "public_read_projects" on public.projects;
create policy "public_read_projects" on public.projects
  for select to anon, authenticated using (true);

drop policy if exists "admin_write_projects" on public.projects;
create policy "admin_write_projects" on public.projects
  for all to authenticated using (true) with check (true);

-- 4) دالة دخول اليتيم (برقم الهوية + تاريخ الميلاد) — آمنة بدون كشف الجدول
create or replace function public.fetch_request(oid text, bd date)
returns setof public.requests
language sql security definer set search_path = public
as $$ select * from public.requests where orphan_id = oid and orphan_birth = bd limit 1; $$;
grant execute on function public.fetch_request(text, date) to anon, authenticated;

-- 5) bucket تخزين صور السلايدر (أنشئه من Storage > New bucket باسم site مع Public)
insert into storage.buckets (id, name, public)
values ('site', 'site', true)
on conflict (id) do update set public = true;

drop policy if exists "public_read_site" on storage.objects;
create policy "public_read_site" on storage.objects
  for select to anon, authenticated using (bucket_id = 'site');

drop policy if exists "admin_write_site" on storage.objects;
create policy "admin_write_site" on storage.objects
  for all to authenticated using (bucket_id = 'site') with check (bucket_id = 'site');

-- 6) بيانات البداية: مشروع كفالة اليتيم + صوره الحالية
insert into public.projects (id, name, description, images) values
('kafala', 'كفالة اليتيم', 'كفالة شاملة لأيتام قطاع غزة',
 '[{"src":"assets/slide1.jpg","t":"من الألم ننهض","s":"لقاء توعوي لأمهات الأيتام"},
    {"src":"assets/slide2.jpg","t":"جلسات التوعية","s":"فريق المؤسسة في لقاء مع الأهالي"},
    {"src":"assets/slide4.jpg","t":"كسوة الأطفال","s":"توزيع الملابس على أطفالنا"},
    {"src":"assets/slide5.jpg","t":"ألعاب حركية","s":"يوم رياضي مفتوح لأطفال المخيم"},
    {"src":"assets/slide6.jpg","t":"بسمة وكسوة","s":"متطوعة المؤسسة مع إحدى طفلاتنا"},
    {"src":"assets/slide7.jpg","t":"حليب الأطفال","s":"توزيع حليب الأطفال على الأسر"},
    {"src":"assets/slide8.jpg","t":"تجمع الأطفال","s":"أطفال المخيم حول متطوعي الفريق"},
    {"src":"assets/slide9.jpg","t":"وجبة ساخنة","s":"أطفال بانتظار توزيع الطعام"},
    {"src":"assets/slide10.jpg","t":"البطانيات والملابس","s":"فريقنا يوزع البطانيات على الأسر"},
    {"src":"assets/slide11.jpg","t":"زيارة الخيام","s":"متطوع يزور خيام النازحين بالمساعدات"},
    {"src":"assets/slide12.jpg","t":"مطبخ الإفطار","s":"تجهيز وجبات رمضان — حملة خليك سند"},
    {"src":"assets/slide13.jpg","t":"يد العطاء","s":"متطوع يسلم مساعدة لإحدى طفلاتنا"},
    {"src":"assets/slide14.jpg","t":"الطرود الغذائية","s":"تجهيز سلال الإفطار والسحور"},
    {"src":"assets/slide15.jpg","t":"وجبة إفطار","s":"وجبة تصل لطفل في المخيم"},
    {"src":"assets/slide16.jpg","t":"توزيع الطعام","s":"أطفال يستلمون وجباتهم"},
    {"src":"assets/slide17.jpg","t":"بطانية شتوية","s":"فتاة تستلم بطانيتها الشتوية"},
    {"src":"assets/slide18.jpg","t":"تسليم البطانيات","s":"بطانيات تصل للأسر النازحة"},
    {"src":"assets/slide19.jpg","t":"سلال رمضان","s":"تجهيز سلال الإفطار داخل الخيمة"}]'::jsonb
)
on conflict (id) do nothing;

-- 7) حساب المدير: أنشئه من Dashboard > Authentication > Add user (email + password)
--    ثم ادخل به من نافذة «دخول المدير» في الموقع.
