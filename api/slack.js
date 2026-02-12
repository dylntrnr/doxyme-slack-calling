const crypto = require("crypto");
const { getUser, setUser } = require("../src/db");
const { normalizeDoxyUrl } = require("../src/doxy");

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSig = req.headers["x-slack-signature"];
  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", SIGNING_SECRET).update(baseString).digest("hex");
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
}

function parseFormBody(body) {
  const params = new URLSearchParams(body);
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}

async function slackAPI(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function handleDoxySetup(params) {
  const url = normalizeDoxyUrl(params.text);
  if (!url) {
    return {
      response_type: "ephemeral",
      text: "Please provide a valid Doxy.me room URL.\nUsage: `/doxy-setup https://doxy.me/yourroom`"
    };
  }

  await setUser(params.user_id, url);
  return {
    response_type: "ephemeral",
    text: `✅ Your Doxy.me room has been linked: ${url}\nUse \`/doxyme @someone\` to invite people to your room.`
  };
}

async function handleDoxyme(params) {
  const callerId = params.user_id;
  const userRecord = await getUser(callerId);

  if (!userRecord || !userRecord.doxyUrl) {
    return {
      response_type: "ephemeral",
      text: "You haven't set up your Doxy.me room yet.\nRun `/doxy-setup https://doxy.me/yourroom` first."
    };
  }

  const doxyUrl = userRecord.doxyUrl;

  // Extract mentioned user IDs: <@U12345> or <@U12345|name>
  const mentionRegex = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;
  const mentionedUsers = [];
  let match;
  while ((match = mentionRegex.exec(params.text || "")) !== null) {
    mentionedUsers.push(match[1]);
  }

  // No users mentioned — post join button in channel
  if (mentionedUsers.length === 0) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `📹 *<@${callerId}> is starting a Doxy.me call*` }
        },
        {
          type: "actions",
          elements: [{
            type: "button",
            text: { type: "plain_text", text: "🔗 Join Doxy.me Call", emoji: true },
            url: doxyUrl,
            style: "primary"
          }]
        }
      ]
    };
  }

  // Get caller name
  let callerName = "Someone";
  try {
    const info = await slackAPI("users.info", { user: callerId });
    if (info.ok && info.user && info.user.profile) {
      callerName = info.user.profile.display_name || info.user.profile.real_name || "Someone";
    }
  } catch (_) {}

  // DM each mentioned user (fire and forget — we already ack'd)
  const sent = [];
  const failed = [];

  for (const userId of mentionedUsers) {
    try {
      const dm = await slackAPI("conversations.open", { users: userId });
      if (!dm.ok) { failed.push(userId); continue; }

      await slackAPI("chat.postMessage", {
        channel: dm.channel.id,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `📹 *${callerName}* is inviting you to a Doxy.me call` }
          },
          {
            type: "actions",
            elements: [{
              type: "button",
              text: { type: "plain_text", text: "🔗 Join Doxy.me Call", emoji: true },
              url: doxyUrl,
              style: "primary"
            }]
          }
        ],
        text: `${callerName} is inviting you to a Doxy.me call: ${doxyUrl}`
      });
      sent.push(userId);
    } catch (_) {
      failed.push(userId);
    }
  }

  const sentList = sent.map(u => `<@${u}>`).join(", ");
  const failedList = failed.map(u => `<@${u}>`).join(", ");
  let msg = sent.length ? `✅ Doxy.me call invite sent to ${sentList}` : "";
  if (failed.length) msg += `\n⚠️ Couldn't DM: ${failedList}`;

  return { response_type: "ephemeral", text: msg || "No invites sent." };
}

module.exports = async (req, res) => {
  // Handle GET (health check)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, app: "doxyme-slack-calling" });
  }

  // Collect raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const contentType = req.headers["content-type"] || "";

  // Handle JSON payloads (URL verification) — must respond before signature check
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(rawBody);
      if (body.type === "url_verification") {
        return res.status(200).json({ challenge: body.challenge });
      }
    } catch (_) {}

    // For other JSON payloads, verify signature
    if (!verifySlackSignature(req, rawBody)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    return res.status(200).json({ ok: true });
  }

  // Verify signature for form-encoded payloads (slash commands)
  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Handle form-encoded payloads (slash commands)
  const params = parseFormBody(rawBody);

  // Immediately respond 200 to avoid timeout, then do work via response_url
  if (params.command === "/doxy-setup" || params.command === "/doxyme") {
    // Send immediate ack
    res.status(200).json({ response_type: "ephemeral", text: "⏳ Working..." });

    // Do the actual work and post result to response_url
    try {
      const handler = params.command === "/doxy-setup" ? handleDoxySetup : handleDoxyme;
      const result = await handler(params);

      if (params.response_url) {
        await fetch(params.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result)
        });
      }
    } catch (err) {
      console.error("Handler error:", err);
      if (params.response_url) {
        await fetch(params.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_type: "ephemeral",
            text: "Something went wrong. Please try again."
          })
        });
      }
    }
    return;
  }

  return res.status(200).json({ ok: true });
};
