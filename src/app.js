const { App, ExpressReceiver, LogLevel } = require("@slack/bolt");
const { v4: uuidv4 } = require("uuid");
const { getUser, setUser } = require("./db");
const { normalizeDoxyUrl } = require("./doxy");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractUserId(event) {
  return (
    event.user_id ||
    event.user ||
    event.initiator ||
    (event.call && (event.call.creator || event.call.user_id)) ||
    null
  );
}

function extractChannelId(event) {
  return (
    event.channel ||
    event.channel_id ||
    (event.call && (event.call.channel_id || event.call.channel)) ||
    (Array.isArray(event.channels) ? event.channels[0] : null) ||
    (event.call && Array.isArray(event.call.channels) ? event.call.channels[0] : null) ||
    null
  );
}

function isCallStartEvent(event) {
  if (!event) return false;
  if (event.type === "call_added" || event.type === "call_started") return true;
  if (event.type === "call") {
    return !event.subtype || event.subtype === "created" || event.subtype === "started";
  }
  return false;
}

function isCallEndEvent(event) {
  if (!event) return false;
  if (event.type === "call_ended") return true;
  if (event.type === "call") {
    return event.subtype === "ended" || event.subtype === "ended_by_user";
  }
  return false;
}

async function safePostEphemeral(client, channel, user, text) {
  if (!channel || !user) return;
  try {
    await client.chat.postEphemeral({ channel, user, text });
  } catch (err) {
    console.error("Failed to post ephemeral message", err);
  }
}

async function handleCallStart({ event, client, logger }) {
  const userId = extractUserId(event);
  const channelId = extractChannelId(event);

  if (!userId) {
    logger.error("Call start event missing user id", { event });
    return;
  }

  const userRecord = await getUser(userId);
  if (!userRecord || !userRecord.doxyUrl) {
    await safePostEphemeral(
      client,
      channelId,
      userId,
      "Please run /doxy-setup with your Doxy.me room URL before starting a call."
    );
    return;
  }

  let displayName = "";
  try {
    const info = await client.users.info({ user: userId });
    const profile = info.user && info.user.profile ? info.user.profile : {};
    displayName = profile.display_name || profile.real_name || "";
  } catch (err) {
    logger.warn("Unable to fetch user info", { error: err });
  }

  const titleSuffix = displayName ? ` via ${displayName}` : "";
  const title = `Doxy.me Call${titleSuffix}`;
  const externalUniqueId = event.call_id || event.external_unique_id || uuidv4();

  try {
    const addResponse = await client.calls.add({
      external_unique_id: externalUniqueId,
      join_url: userRecord.doxyUrl,
      desktop_app_join_url: userRecord.doxyUrl,
      title
    });

    if (addResponse && addResponse.call && addResponse.call.id) {
      try {
        await client.calls.update({
          id: addResponse.call.id,
          join_url: userRecord.doxyUrl,
          desktop_app_join_url: userRecord.doxyUrl,
          title
        });
      } catch (err) {
        logger.warn("calls.update failed", { error: err });
      }
    }
  } catch (err) {
    logger.error("calls.add failed", { error: err });
    await safePostEphemeral(
      client,
      channelId,
      userId,
      "There was a problem starting your Doxy.me call. Please try again."
    );
  }
}

async function handleCallEnd({ event, client, logger }) {
  const callId = event.call_id || event.id || (event.call && event.call.id) || null;
  const externalUniqueId = event.external_unique_id || (event.call && event.call.external_unique_id) || null;

  if (!callId && !externalUniqueId) {
    logger.warn("Call end event missing identifiers", { event });
    return;
  }

  try {
    await client.calls.end({
      id: callId,
      external_unique_id: externalUniqueId
    });
  } catch (err) {
    logger.warn("calls.end failed", { error: err });
  }
}

function buildApp() {
  const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
  const botToken = requireEnv("SLACK_BOT_TOKEN");

  const receiver = new ExpressReceiver({
    signingSecret,
    endpoints: "/api/slack",
    processBeforeResponse: true
  });

  const app = new App({
    token: botToken,
    receiver,
    logLevel: LogLevel.INFO
  });

  app.command("/doxy-setup", async ({ command, ack, respond, logger }) => {
    await ack();

    const normalized = normalizeDoxyUrl(command.text);
    if (!normalized) {
      await respond({
        response_type: "ephemeral",
        text: "Please provide a valid Doxy.me room URL, e.g. /doxy-setup https://doxy.me/yourroom."
      });
      return;
    }

    try {
      await setUser(command.user_id, normalized);
      await respond({
        response_type: "ephemeral",
        text: "✅ Your Doxy.me room has been linked. You can now use the phone icon to start calls."
      });
    } catch (err) {
      logger.error("Failed to store user mapping", { error: err });
      await respond({
        response_type: "ephemeral",
        text: "Sorry, something went wrong saving your Doxy.me URL. Please try again."
      });
    }
  });

  const callHandler = async ({ event, client, logger }) => {
    if (isCallEndEvent(event)) {
      await handleCallEnd({ event, client, logger });
      return;
    }
    if (isCallStartEvent(event)) {
      await handleCallStart({ event, client, logger });
    }
  };

  app.event("call", callHandler);
  app.event("call_added", callHandler);
  app.event("call_started", callHandler);
  app.event("call_ended", callHandler);

  app.error((error) => {
    console.error("Slack app error", error);
  });

  return { app, receiver };
}

module.exports = {
  buildApp
};
