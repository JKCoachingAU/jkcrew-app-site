function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function env(name) {
  return Netlify.env.get(name) || "";
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { to, message } = await req.json();
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");

  if (!sid || !token || !from) {
    return json({ error: "Twilio environment variables are not configured" }, 500);
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: message
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const result = await response.json();
  return json({ ok: response.ok, result }, response.ok ? 200 : 500);
};

export const config = {
  path: "/api/send-sms",
  method: ["POST"]
};
