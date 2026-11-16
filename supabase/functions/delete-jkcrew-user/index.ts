import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const allowedOrigins = new Set(["https://jkcoachingau.github.io", "http://127.0.0.1:4173", "http://localhost:4173"]);
const jsonHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://jkcoachingau.github.io",
  "Content-Type": "application/json",
  "Vary": "Origin",
});
const respond = (origin: string | null, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders(origin) });
  if (req.method !== "POST" || !origin || !allowedOrigins.has(origin)) return respond(origin, { error: "Account deletion is only available inside JKCREW." }, 403);
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
    const body = await req.json();
    const targetUserId = String(body.userId || "").trim();
    if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) return respond(origin, { error: "Missing account details." }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller.user?.id) return respond(origin, { error: "Sign in again before deleting an account." }, 401);
    if (caller.user.id === targetUserId) return respond(origin, { error: "You cannot delete your own account from here." }, 400);
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: access, error: accessError } = await userClient.rpc("get_my_team_access");
    if (accessError || access?.approval_status !== "approved") return respond(origin, { error: "Approved team coach access is required." }, 403);
    // This check uses current database approval and every target relationship,
    // including parents with children. Platform ownership adds no team access.
    const { data: permitted, error: permissionError } = await userClient.rpc("can_coach_delete_account", { p_target_id: targetUserId });
    if (permissionError || permitted !== true) return respond(origin, { error: "That account is outside your team or cannot be deleted." }, 403);
    const { data: target, error: targetError } = await userClient.from("profiles").select("id,display_name,role").eq("id", targetUserId).maybeSingle();
    if (targetError || !target || !["athlete", "parent"].includes(target.role)) return respond(origin, { error: "That account could not be deleted." }, 403);
    const { data: prepared, error: preparationError } = await userClient.rpc("prepare_coach_account_deletion", { p_target_id: targetUserId });
    if (preparationError || prepared?.ready !== true) return respond(origin, { error: "Account deletion could not be authorized. Your account data has not been deleted." }, 403);
    // Delete through Auth only after the user-scoped database checks succeed.
    // Existing Auth foreign-key cleanup removes the associated profile data.
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) throw deleteError;
    return respond(origin, { deleted: true, displayName: target.display_name, role: target.role });
  } catch (error) {
    console.error("Account deletion failed", error);
    return respond(origin, { error: "Could not delete that account. Please try again." }, 500);
  }
});
