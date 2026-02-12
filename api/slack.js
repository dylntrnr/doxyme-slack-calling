const crypto = require("crypto");
const { getUser, setUser } = require("../src/db");
const { normalizeDoxyUrl } = require("../src/doxy");

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSig = req.headers["x-slack-signature"];
  if (!timestamp || !slackSig) return false;
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

// /doxyme setup <url> — save room
// /doxyme @user — DM them your link
// /doxyme — post join button in channel
async function handleDoxyme(params) {
  const callerId = params.user_id;
  const text = (params.text || "").trim();

  // Setup mode: /doxyme setup https://doxy.me/room
  if (text.toLowerCase().startsWith("setup ")) {
    const urlPart = text.slice(6).trim();
    const url = normalizeDoxyUrl(urlPart);
    if (!url) {
      return {
        response_type: "ephemeral",
        text: "Invalid URL. Usage: `/doxyme setup https://doxy.me/yourroom`"
      };
    }
    await setUser(callerId, url);
    return {
      response_type: "ephemeral",
      text: `✅ Room linked: ${url}\nNow use \`/doxyme @someone\` to invite, or \`/doxyme\` to post in channel.`
    };
  }

  // Everything else needs a saved room
  const userRecord = await getUser(callerId);
  if (!userRecord || !userRecord.doxyUrl) {
    return {
      response_type: "ephemeral",
      text: "Set up your room first: `/doxyme setup https://doxy.me/yourroom`"
    };
  }

  const doxyUrl = userRecord.doxyUrl;

  // Extract @mentions
  const mentionRegex = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;
  const mentionedUsers = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentionedUsers.push(match[1]);
  }

  // No mentions — post join button in channel
  if (mentionedUsers.length === 0) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `📹 *<@${callerId}> is starting a Doxy.me call*\n${doxyUrl}` }
        },
        {
          type: "actions",
          elements: [{
            type: "button",
            text: { type: "plain_text", text: "🔗 Join Call", emoji: true },
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

  // DM each mentioned user
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
            text: { type: "mrkdwn", text: `📹 *${callerName}* is inviting you to a Doxy.me call\n${doxyUrl}` }
          },
          {
            type: "actions",
            elements: [{
              type: "button",
              text: { type: "plain_text", text: "🔗 Join Call", emoji: true },
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
  let msg = sent.length ? `✅ Invite sent to ${sentList}` : "";
  if (failed.length) msg += `\n⚠️ Couldn't DM: ${failedList}`;
  return { response_type: "ephemeral", text: msg || "No invites sent." };
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, app: "doxyme-slack-calling" });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const contentType = req.headers["content-type"] || "";

  // URL verification (Slack sends this when saving Request URLs)
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(rawBody);
      if (body.type === "url_verification") {
        return res.status(200).json({ challenge: body.challenge });
      }
    } catch (_) {}
    if (!verifySlackSignature(req, rawBody)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    return res.status(200).json({ ok: true });
  }

  // Slash commands
  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const params = parseFormBody(rawBody);

  if (params.command === "/doxyme") {
    // Ack immediately
    res.status(200).json({ response_type: "ephemeral", text: "⏳" });
    
    try {
      const result = await handleDoxyme(params);
      if (params.response_url) {
        await fetch(params.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result)
        });
      }
    } catch (err) {
      console.error("Error:", err);
      if (params.response_url) {
        await fetch(params.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_type: "ephemeral", text: "Something went wrong." })
        });
      }
    }
    return;
  }

  return res.status(200).json({ ok: true });
};
