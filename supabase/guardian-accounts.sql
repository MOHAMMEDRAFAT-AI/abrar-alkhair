-- ============================================================
-- ترقية: حساب الوصي بدل حساب اليتيم
-- نفّذ هذا الملف مرة واحدة في Supabase Dashboard > SQL Editor > Run
-- لا يحذف أو يعدّل أي بيانات — يضيف دالة الدخول الجديدة فقط.
-- ============================================================

-- دخول الوصي: رقم هويته + تاريخ ميلاده — يرجع جميع الأيتام المسجلين تحته وحالة كل يتيم
create or replace function public.fetch_guardian_requests(gid text, gbd date)
returns setof public.requests
language sql security definer set search_path = public
as $$
  select * from public.requests
  where guardian_id = gid
    and exists (
      select 1 from public.requests r2
      where r2.guardian_id = gid and r2.guardian_birth = gbd
    )
  order by created_at asc;
$$;

grant execute on function public.fetch_guardian_requests(text, date) to anon, authenticated;
