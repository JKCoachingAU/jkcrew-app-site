import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const allowedOrigins = new Set([
  "https://jkcoachingau.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const jsonHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://jkcoachingau.github.io",
  "Content-Type": "application/json",
  "Vary": "Origin",
});

const respond = (origin: string | null, body: Record<string, unknown>, status = 200) => (
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) })
);

const normaliseCountryCode = (value: unknown) => String(value || "").trim().toUpperCase();
const normaliseCountryName = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ");

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders(origin) });
  if (req.method !== "POST" || !origin || !allowedOrigins.has(origin)) {
    return respond(origin, { error: "Account creation is only available inside JKCREW." }, 403);
  }

  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim().replace(/\s+/g, " ");
    const role = String(body.role || "");
    const countryCode = normaliseCountryCode(body.countryCode);
    const countryName = normaliseCountryName(body.countryName);
    const teamRole = String(body.teamRole || "head_coach");
    const teamName = String(body.teamName || "").trim().replace(/\s+/g, " ");
    const inviteCode = String(body.inviteCode || "").trim().toUpperCase();

    if (body.website) return respond(origin, { error: "Could not create account." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return respond(origin, { error: "Enter a valid email address." });
    }
    if (password.length < 8 || password.length > 72) {
      return respond(origin, { error: "Password must be between 8 and 72 characters." });
    }
    if (!displayName || displayName.length > 60) {
      return respond(origin, { error: "Display name must be between 1 and 60 characters." });
    }
    if (!["athlete", "parent", "coach"].includes(role)) {
      return respond(origin, { error: "Choose an athlete, parent or coach account." });
    }
    if (role === "coach" && !/^[A-Z]{2}$/.test(countryCode)) {
      return respond(origin, { error: "Choose a valid two-letter country code." });
    }
    if (countryName.length > 80) {
      return respond(origin, { error: "Country name is too long." });
    }
    if (role === "coach" && !["head_coach", "coach", "assistant_coach"].includes(teamRole)) {
      return respond(origin, { error: "Choose a valid team role." }, 400);
    }
    if (role === "coach" && teamRole === "head_coach" && (!teamName || teamName.length > 80)) {
      return respond(origin, { error: "Add a team name between 1 and 80 characters." }, 400);
    }
    if ((inviteCode || (role === "coach" && teamRole !== "head_coach")) && !/^[0-9A-F]{32}$/.test(inviteCode)) {
      return respond(origin, { error: "Enter a valid team invitation code." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let registeredCoachId: string | null = null;
    // A real signed-in coach may register their students. The caller ID is
    // verified by Auth and the database; request-body IDs are never trusted.
    if (token && token !== anonKey) {
      const { data: caller, error: callerError } = await admin.auth.getUser(token);
      if (callerError || !caller.user?.id) return respond(origin, { error: "Sign in again before registering a team account." }, 401);
      const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: access, error: accessError } = await userClient.rpc("get_my_team_access");
      if (accessError || access?.approval_status !== "approved" || !access?.team?.id) {
        return respond(origin, { error: "Approved team coach access is required to register students." }, 403);
      }
      if (["athlete", "parent"].includes(role)) registeredCoachId = caller.user.id;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role, ...(registeredCoachId ? { registered_coach_id: registeredCoachId } : {}) },
      user_metadata: { display_name: displayName, role, country_code: countryCode, country_name: countryName },
    });

    if (error || !data.user?.id) {
      const message = String(error?.message || "").toLowerCase().includes("already")
        ? "An account with that email already exists."
        : "Could not create the account. Please try again.";
      return respond(origin, { error: message });
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      display_name: displayName,
      email,
      role,
      country_code: countryCode,
      country_name: countryName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      console.error("Profile creation failed", profileError);
      return respond(origin, { error: "Could not create the account profile. Please try again." }, 500);
    }

    if (role === "coach" || (inviteCode && !registeredCoachId)) {
      const initialization = role === "coach"
        ? await admin.rpc("initialize_registered_coach", { p_coach_id: data.user.id, p_team_role: teamRole, p_team_name: teamName, p_invite_code: inviteCode })
        : await admin.rpc("initialize_registered_team_member", { p_user_id: data.user.id, p_role: role, p_invite_code: inviteCode });
      if (initialization.error || !initialization.data) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
        if (cleanupError) console.error("New account rollback failed", cleanupError);
        return respond(origin, { error: "The team registration could not be verified. Check the team name or invitation code and try again." }, 400);
      }
    }

    return respond(origin, { userId: data.user.id, ...(role === "coach" ? { approvalStatus: "pending" } : {}) }, 201);
  } catch (error) {
    console.error("Account creation failed", error);
    return respond(origin, { error: "Could not create the account. Please try again." }, 500);
  }
});

