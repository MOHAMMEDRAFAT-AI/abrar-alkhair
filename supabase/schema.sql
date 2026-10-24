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

-- 3) جدول الإعدادات العامة (إيقاف/استئناف استقبال الطلبات)
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value)
values ('submissions', '{"open": true}'::jsonb)
on conflict (key) do nothing;

-- 4) جدول المدراء المعتمدين (حماية الصلاحيات)
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- دالة فحص هل المستخدم الحالي مدير معتمد
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where id = auth.uid()
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

drop policy if exists "admin_users_read" on public.admin_users;
create policy "admin_users_read" on public.admin_users
  for select to authenticated using (public.is_admin());

-- 5) تفعيل RLS + السياسات المحكمة
alter table public.requests enable row level security;
alter table public.projects enable row level security;
alter table public.settings enable row level security;

drop policy if exists "public_read_settings" on public.settings;
create policy "public_read_settings" on public.settings
  for select to anon, authenticated using (true);

drop policy if exists "admin_write_settings" on public.settings;
create policy "admin_write_settings" on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.submissions_open()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select (value->>'open')::boolean from public.settings where key = 'submissions'),
    true
  );
$$;
grant execute on function public.submissions_open() to anon, authenticated;

drop policy if exists "public_insert_requests" on public.requests;
create policy "public_insert_requests" on public.requests
  for insert to anon, authenticated with check (public.submissions_open());

drop policy if exists "admin_all_requests" on public.requests;
create policy "admin_all_requests" on public.requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public_read_projects" on public.projects;
create policy "public_read_projects" on public.projects
  for select to anon, authenticated using (true);

drop policy if exists "admin_write_projects" on public.projects;
create policy "admin_write_projects" on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6) جدول تعقب محاولات الدخول وحماية مصادقة الوصي (Rate Limiting)
create table if not exists public.guardian_login_attempts (
  id bigserial primary key,
  target_gid text not null,
  attempt_time timestamptz not null default now()
);
create index if not exists idx_guardian_login_attempts_target 
  on public.guardian_login_attempts (target_gid, attempt_time desc);

create or replace function public.fetch_guardian_requests(gid text, gbd date)
returns table (
  id bigint,
  orphan_name text,
  orphan_id text,
  orphan_birth date,
  orphan_gender text,
  guardian_name text,
  guardian_id text,
  guardian_rel text,
  original_address text,
  displacement_address text,
  phone_primary text,
  health_status text,
  health_note text,
  status text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_attempts int;
  v_clean_gid text;
begin
  v_clean_gid := trim(gid);
  delete from public.guardian_login_attempts where attempt_time < now() - interval '30 minutes';

  select count(*) into v_attempts
  from public.guardian_login_attempts
  where target_gid = v_clean_gid and attempt_time >= now() - interval '15 minutes';

  if v_attempts >= 5 then
    raise exception 'تم تجاوز الحد الأقصى للمحاولات (5 محاولات). يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.';
  end if;

  if not exists (
    select 1 from public.requests r
    where r.guardian_id = v_clean_gid and r.guardian_birth = gbd
  ) then
    insert into public.guardian_login_attempts (target_gid) values (v_clean_gid);
    return;
  end if;

  delete from public.guardian_login_attempts where target_gid = v_clean_gid;

  return query
  select 
    r.id,
    r.orphan_name,
    r.orphan_id,
    r.orphan_birth,
    r.orphan_gender,
    r.guardian_name,
    r.guardian_id,
    r.guardian_rel,
    r.original_address,
    r.displacement_address,
    r.phone_primary,
    r.health_status,
    r.health_note,
    r.status,
    r.created_at
  from public.requests r
  where r.guardian_id = v_clean_gid
  order by r.created_at asc;
end;
$$;
grant execute on function public.fetch_guardian_requests(text, date) to anon, authenticated;

-- 7) bucket تخزين صور السلايدر
insert into storage.buckets (id, name, public)
values ('site', 'site', true)
on conflict (id) do update set public = true;

drop policy if exists "public_read_site" on storage.objects;
create policy "public_read_site" on storage.objects
  for select to anon, authenticated using (bucket_id = 'site');

drop policy if exists "admin_write_site" on storage.objects;
create policy "admin_write_site" on storage.objects
  for all to authenticated
  using (bucket_id = 'site' and public.is_admin())
  with check (bucket_id = 'site' and public.is_admin());

-- 7) بيانات البداية: مشروع كفالة اليتيم + صوره الحالية
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

-- 8) حساب المدير: أنشئه من Dashboard > Authentication > Add user (email + password)
--    ثم ادخل به من نافذة «دخول المدير» في الموقع.
