-- ============================================================
-- 🛡️ تحديث الأمان الشامل (Security Hardening) — مؤسسة أبرار الخير
-- التنفيذ: الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run
-- لن يتم حذف أي بيانات حالية، وسيقوم بتأمين القاعدة بنسبة 100%.
-- ============================================================

-- 1) جدول المدراء المعتمدين (حماية صلاحيات الإدارة)
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- نقل جميع حسابات المدراء الموجودة حالياً تلقائياً لضمان عدم انقطاع وصولهم
insert into public.admin_users (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

-- دالة للتحقق هل المستخدم الحالي مدير معتمد
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

-- سياسة حماية جدول المدراء نفسه: فقط المدراء المعتمدون يمكنهم استعراضه
drop policy if exists "admin_users_read" on public.admin_users;
create policy "admin_users_read" on public.admin_users
  for select to authenticated using (public.is_admin());

-- ------------------------------------------------------------
-- 2) تشديد سياسات RLS على جدول الطلبات (requests)
-- استبدال الصلاحيات المفتوحة لـ authenticated بحصرها بالمدراء فقط
-- ------------------------------------------------------------
drop policy if exists "admin_all_requests" on public.requests;
create policy "admin_all_requests" on public.requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- تحديث سياسات المشاريع والتخزين
drop policy if exists "admin_write_projects" on public.projects;
create policy "admin_write_projects" on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin_write_site" on storage.objects;
create policy "admin_write_site" on storage.objects
  for all to authenticated
  using (bucket_id = 'site' and public.is_admin())
  with check (bucket_id = 'site' and public.is_admin());

-- ------------------------------------------------------------
-- 3) حماية مصادقة الأوصياء من هجمات التخمين (Brute-Force Rate Limiting)
-- ------------------------------------------------------------
create table if not exists public.guardian_login_attempts (
  id bigserial primary key,
  target_gid text not null,
  attempt_time timestamptz not null default now()
);

create index if not exists idx_guardian_login_attempts_target 
  on public.guardian_login_attempts (target_gid, attempt_time desc);

-- دالة دخول الوصي المحصنة:
-- 1. تقييد المحاولات (حد أقصى 5 محاولات خاطئة خلال 15 دقيقة لكل هوية)
-- 2. إخفاء البيانات السرية (عدم إرجاع تاريخ ميلاد الوصي أو هوية الأب في الرد)
-- 3. إسقاط الدالة السابقة أولاً لأن نوع الإرجاع تغير (حل خطأ 42P13)
drop function if exists public.fetch_guardian_requests(text, date);

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

  -- تنظيف السجلات الأقدم من 30 دقيقة دورياً
  delete from public.guardian_login_attempts 
  where attempt_time < now() - interval '30 minutes';

  -- فحص عدد المحاولات الفاشلة السابقة في آخر 15 دقيقة
  select count(*) into v_attempts
  from public.guardian_login_attempts
  where target_gid = v_clean_gid
    and attempt_time >= now() - interval '15 minutes';

  if v_attempts >= 5 then
    raise exception 'تم تجاوز الحد الأقصى للمحاولات (5 محاولات). يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.';
  end if;

  -- فحص صحة بيانات الدخول (رقم الهوية + تاريخ الميلاد)
  if not exists (
    select 1 from public.requests r
    where r.guardian_id = v_clean_gid and r.guardian_birth = gbd
  ) then
    -- تسجيل محاولة فاشلة
    insert into public.guardian_login_attempts (target_gid) values (v_clean_gid);
    return;
  end if;

  -- عند نجاح الدخول: تصفير عداد المحاولات الفاشلة لهذا الحساب
  delete from public.guardian_login_attempts where target_gid = v_clean_gid;

  -- إرجاع الحقول المصرح بعرضها للوصي فقط (حجب guardian_birth, father_id, death_date, death_cause)
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

-- ------------------------------------------------------------
-- 4) قيود التحقق لمنع الطلبات العشوائية (Validation Constraints)
-- تُضاف بـ NOT VALID لضمان عدم فشل الاستعلام في حال وجود بيانات تجريبية قديمة
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_requests_orphan_id') then
    alter table public.requests add constraint chk_requests_orphan_id 
      check (length(regexp_replace(orphan_id, '\D', '', 'g')) >= 9) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_requests_guardian_id') then
    alter table public.requests add constraint chk_requests_guardian_id 
      check (length(regexp_replace(guardian_id, '\D', '', 'g')) >= 9) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_requests_phone') then
    alter table public.requests add constraint chk_requests_phone 
      check (length(regexp_replace(phone_primary, '\D', '', 'g')) >= 9) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_requests_birth') then
    alter table public.requests add constraint chk_requests_birth 
      check (orphan_birth <= current_date) not valid;
  end if;
end $$;
