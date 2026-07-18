import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-worker-secret",
};

type QueueItem = {
  id: string;
  recipient_id: string;
  notification_type: string;
  title: string;
  body: string;
  url: string;
  payload: Record<string, unknown>;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const workerSecret = request.headers.get("x-push-worker-secret") || "";
  if (!workerSecret) return response({ error: "Missing worker secret" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return response({ error: "Push worker is not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: configRows, error: configError } = await supabase.rpc("get_jkcrew_push_worker_config", {
      p_worker_secret: workerSecret,
    });
    if (configError) throw configError;
    const config = Array.isArray(configRows) ? configRows[0] : configRows;
    if (!config?.vapid_public_key || !config?.vapid_private_key) {
      throw new Error("VAPID keys are not configured");
    }

    webpush.setVapidDetails(
      config.vapid_subject || "mailto:joshkhourybmx@gmail.com",
      config.vapid_public_key,
      config.vapid_private_key,
    );

    const { data: queueRows, error: claimError } = await supabase.rpc("claim_jkcrew_push_notifications", {
      p_worker_secret: workerSecret,
      p_limit: 50,
    });
    if (claimError) throw claimError;

    const queue = (queueRows || []) as QueueItem[];
    let deliveredTotal = 0;
    let failedTotal = 0;

    for (const item of queue) {
      const { data: subscriptionRows, error: subscriptionError } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", item.recipient_id)
        .eq("enabled", true)
        .limit(12);

      let delivered = 0;
      let failed = 0;
      const errors: string[] = [];

      if (subscriptionError) {
        failed = 1;
        errors.push(subscriptionError.message);
      } else {
        for (const subscription of (subscriptionRows || []) as SubscriptionRow[]) {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify({
                title: item.title,
                body: item.body,
                url: item.url || "./",
                type: item.notification_type,
                notificationId: item.id,
                ...(item.payload || {}),
              }),
              {
                TTL: item.notification_type === "crew_chat" ? 60 * 60 * 6 : 60 * 60 * 24 * 3,
                urgency: item.notification_type === "crew_chat" ? "high" : "normal",
              },
            );
            delivered += 1;
            await supabase.from("push_subscriptions").update({
              last_success_at: new Date().toISOString(),
              last_error: "",
              failure_count: 0,
              updated_at: new Date().toISOString(),
            }).eq("id", subscription.id);
          } catch (error) {
            failed += 1;
            const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
            await supabase.from("push_subscriptions").update({
              enabled: statusCode === 404 || statusCode === 410 ? false : true,
              last_error: message.slice(0, 500),
              failure_count: statusCode === 404 || statusCode === 410 ? 99 : 1,
              updated_at: new Date().toISOString(),
            }).eq("id", subscription.id);
          }
        }
      }

      deliveredTotal += delivered;
      failedTotal += failed;
      const { error: finishError } = await supabase.rpc("finish_jkcrew_push_notification", {
        p_worker_secret: workerSecret,
        p_notification_id: item.id,
        p_delivered: delivered,
        p_failed: failed,
        p_error: errors.join(" | ").slice(0, 1000),
      });
      if (finishError) console.error("Could not finish push queue item", item.id, finishError);
    }

    return response({ claimed: queue.length, delivered: deliveredTotal, failed: failedTotal });
  } catch (error) {
    console.error("JKCREW push worker failed", error);
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
