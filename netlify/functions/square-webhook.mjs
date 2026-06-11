import crypto from "node:crypto";
import { buildSignupSms, normalizeSquareOrder } from "../../lib/square-order-mapper.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function env(name) {
  return Netlify.env.get(name) || "";
}

function verifySquareSignature(rawBody, signature) {
  const signatureKey = env("SQUARE_WEBHOOK_SIGNATURE_KEY");
  const notificationUrl = env("SQUARE_WEBHOOK_NOTIFICATION_URL");
  if (!signatureKey || !notificationUrl || !signature) return false;

  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function retrieveOrder(orderId) {
  const token = env("SQUARE_ACCESS_TOKEN");
  const baseUrl = env("SQUARE_ENVIRONMENT") === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
  if (!token || !orderId) return null;

  const response = await fetch(`${baseUrl}/v2/orders/${orderId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Square-Version": "2026-05-20",
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) return null;
  return response.json();
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") || "";
  if (!verifySquareSignature(rawBody, signature)) {
    return json({ error: "Invalid Square signature" }, 401);
  }

  const event = JSON.parse(rawBody);
  const orderId = event?.data?.id || event?.data?.object?.order?.id;
  const fullOrder = await retrieveOrder(orderId);
  const normalized = normalizeSquareOrder(fullOrder || event);
  const sms = buildSignupSms({
    riderName: normalized.riderName,
    signupUrl: env("JK_APP_SIGNUP_URL") || "https://jkcommunity.app/signup"
  });

  return json({
    ok: true,
    orderId,
    normalized,
    sms,
    next: "Store this normalized order in your database and match line items to configured JKCommunity classes."
  });
};

export const config = {
  path: "/api/square-webhook",
  method: ["POST"]
};
