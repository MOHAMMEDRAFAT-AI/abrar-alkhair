// Edge Function: create-admin — إدارة حسابات المدراء (يتطلب دخول مدير)
// النشر: npx supabase login → npx supabase link --project-ref <ref> → npx supabase functions deploy create-admin
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// السماح فقط للنطاقات المعروفة — عدّل ALLOWED_ORIGINS حسب نطاق موقعك
const ALLOWED_ORIGINS = [
  'https://irwmxhkqoueqmmikwjye.supabase.co',
  // أضف نطاق موقعك هنا، مثال:
  // 'https://abrar-alkhair.ps',
  // 'http://localhost:3000',  // للتطوير المحلي فقط
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}
const json = (b: unknown, headers: Record<string,string>, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, cors, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { action, email, password, id } = await req.json();

    if (action === "list") {
      const { data, error } = await admin.auth.admin.listUsers();
      if (error) return json({ error: error.message }, cors, 400);
      return json({ users: data.users.map((u) => ({ id: u.id, email: u.email, created: u.created_at })) }, cors);
    }
    if (action === "create") {
      if (!email || !password || password.length < 6) return json({ error: "invalid" }, cors, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: error.message }, cors, 400);
      return json({ ok: true, id: data.user.id }, cors);
    }
    if (action === "delete") {
      if (!id || id === user.id) return json({ error: "no-self" }, cors, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, cors, 400);
      return json({ ok: true }, cors);
    }
    return json({ error: "bad-action" }, cors, 400);
  } catch (e) {
    return json({ error: String(e) }, getCorsHeaders(req), 500);
  }
});
