-- ============================================================
-- ترقية: إيقاف/استئناف استقبال طلبات الكفالة من لوحة المدير
-- نفّذ هذا الملف مرة واحدة في Supabase Dashboard > SQL Editor > Run
-- لا يحذف أي بيانات.
-- ============================================================

-- 1) جدول الإعدادات العامة
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) القراءة متاحة للجميع (لمعرفة حالة الاستقبال)، والكتابة للمدير المسجل فقط
alter table public.settings enable row level security;

drop policy if exists "public_read_settings" on public.settings;
create policy "public_read_settings" on public.settings
  for select to anon, authenticated using (true);

drop policy if exists "admin_write_settings" on public.settings;
create policy "admin_write_settings" on public.settings
  for all to authenticated using (true) with check (true);

-- 3) القيمة الافتراضية: الاستقبال مفتوح
insert into public.settings (key, value)
values ('submissions', '{"open": true}'::jsonb)
on conflict (key) do nothing;

-- 4) دالة تتحقق من حالة الاستقبال (تُستخدم في سياسة الإدخال)
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

-- 5) منع إدخال طلبات جديدة من أي مصدر أثناء الإيقاف (وليس فقط من الواجهة)
drop policy if exists "public_insert_requests" on public.requests;
create policy "public_insert_requests" on public.requests
  for insert to anon, authenticated
  with check (public.submissions_open());
