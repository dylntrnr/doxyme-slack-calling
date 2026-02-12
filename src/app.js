const { App, ExpressReceiver, LogLevel } = require("@slack/bolt");
const { getUser, setUser } = require("./db");
const { normalizeDoxyUrl } = require("./doxy");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildApp() {
  const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
  const botToken = requireEnv("SLACK_BOT_TOKEN");

  const receiver = new ExpressReceiver({
    signingSecret,
    endpoints: "/api/slack",
    processBeforeResponse: false
  });

  const app = new App({
    token: botToken,
    receiver,
    logLevel: LogLevel.INFO
  });

  // /doxy-setup <url> — save your doxy.me room link
  app.command("/doxy-setup", async ({ command, ack, respond, logger }) => {
    await ack();

    const normalized = normalizeDoxyUrl(command.text);
    if (!normalized) {
      await respond({
        response_type: "ephemeral",
        text: "Please provide a valid Doxy.me room URL.\nUsage: `/doxy-setup https://doxy.me/yourroom`"
      });
      return;
    }

    try {
      await setUser(command.user_id, normalized);
      await respond({
        response_type: "ephemeral",
        text: `✅ Your Doxy.me room has been linked: ${normalized}\nUse \`/doxyme @someone\` to invite people to your room.`
      });
    } catch (err) {
      logger.error("Failed to store user mapping", { error: err });
      await respond({
        response_type: "ephemeral",
        text: "Something went wrong saving your URL. Please try again."
      });
    }
  });

  // /doxyme [@user ...] — DM mentioned users your doxy.me link
  app.command("/doxyme", async ({ command, ack, client, respond, logger }) => {
    await ack();

    const callerId = command.user_id;
    const userRecord = await getUser(callerId);

    if (!userRecord || !userRecord.doxyUrl) {
      await respond({
        response_type: "ephemeral",
        text: "You haven't set up your Doxy.me room yet.\nRun `/doxy-setup https://doxy.me/yourroom` first."
      });
      return;
    }

    const doxyUrl = userRecord.doxyUrl;

    // Extract mentioned user IDs from Slack's escaped format: <@U12345> or <@U12345|name>
    const mentionRegex = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;
    const mentionedUsers = [];
    let match;
    while ((match = mentionRegex.exec(command.text)) !== null) {
      mentionedUsers.push(match[1]);
    }

    // If no users mentioned, post the link in the channel
    if (mentionedUsers.length === 0) {
      await respond({
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📹 *<@${callerId}> is starting a Doxy.me call*`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🔗 Join Doxy.me Call", emoji: true },
                url: doxyUrl,
                style: "primary"
              }
            ]
          }
        ]
      });
      return;
    }

    // Get caller's display name
    let callerName = "Someone";
    try {
      const info = await client.users.info({ user: callerId });
      const profile = info.user && info.user.profile ? info.user.profile : {};
      callerName = profile.display_name || profile.real_name || "Someone";
    } catch (err) {
      logger.warn("Unable to fetch caller info", { error: err });
    }

    // DM each mentioned user
    const sent = [];
    const failed = [];

    for (const userId of mentionedUsers) {
      try {
        // Open a DM channel with the user
        const dm = await client.conversations.open({ users: userId });
        const channelId = dm.channel.id;

        await client.chat.postMessage({
          channel: channelId,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `📹 *${callerName}* is inviting you to a Doxy.me call`
              }
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "🔗 Join Doxy.me Call", emoji: true },
                  url: doxyUrl,
                  style: "primary"
                }
              ]
            }
          ],
          text: `${callerName} is inviting you to a Doxy.me call: ${doxyUrl}`
        });
        sent.push(userId);
      } catch (err) {
        logger.error(`Failed to DM user ${userId}`, { error: err });
        failed.push(userId);
      }
    }

    // Also post in the channel where the command was run
    const sentList = sent.map(u => `<@${u}>`).join(", ");
    const failedList = failed.map(u => `<@${u}>`).join(", ");

    let statusMsg = `✅ Doxy.me call invite sent to ${sentList}`;
    if (failed.length > 0) {
      statusMsg += `\n⚠️ Couldn't DM: ${failedList} (they may need to add the Doxy.me app first)`;
    }

    await respond({
      response_type: "ephemeral",
      text: statusMsg
    });
  });

  app.error((error) => {
    console.error("Slack app error", error);
  });

  return { app, receiver };
}

module.exports = {
  buildApp
};
