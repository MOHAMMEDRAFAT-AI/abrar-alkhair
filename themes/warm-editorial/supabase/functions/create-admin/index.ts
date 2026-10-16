// Edge Function: create-admin — إدارة حسابات المدراء (يتطلب دخول مدير)
// النشر: npx supabase login → npx supabase link --project-ref <ref> → npx supabase functions deploy create-admin
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { action, email, password, id } = await req.json();

    if (action === "list") {
      const { data, error } = await admin.auth.admin.listUsers();
      if (error) return json({ error: error.message }, 400);
      return json({ users: data.users.map((u) => ({ id: u.id, email: u.email, created: u.created_at })) });
    }
    if (action === "create") {
      if (!email || !password || password.length < 6) return json({ error: "invalid" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, id: data.user.id });
    }
    if (action === "delete") {
      if (!id || id === user.id) return json({ error: "no-self" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "bad-action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
