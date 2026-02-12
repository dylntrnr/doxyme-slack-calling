# Doxy.me Slack Calling Integration

A production-ready Slack Call Provider app that routes Slack phone icon calls to a user's Doxy.me room. Includes `/doxy-setup` for user linking and the Slack Calls API (`calls.add`, `calls.update`, `calls.end`).

## Features
- `/doxy-setup` slash command to link a user's Doxy.me room URL
- Slack Calls API integration that creates Doxy.me calls on phone icon clicks
- JSON-based user mapping for MVP (with configurable data directory)
- Vercel-ready serverless deployment

## Requirements
- Node.js 18+
- A Slack workspace where you can install a custom app
- Vercel CLI authenticated with `VERCEL_TOKEN`

## Environment Variables
Create `.env` locally (see `.env.example`):
- `SLACK_BOT_TOKEN` (xoxb-...)
- `SLACK_SIGNING_SECRET`
- `DATA_DIR` (optional; defaults to `./data` if writable, otherwise `/tmp/doxyme-slack-calling`)

## Local Development
```bash
npm install
npm run dev
```

The server listens on `http://localhost:3000`.

## Slack App Setup (api.slack.com)
1. Create a new Slack app “From an app manifest.”
2. Paste the manifest below and replace `https://YOUR_DOMAIN` with your deployed Vercel URL.
3. Install the app to your workspace.
4. Set the workspace Call Provider to this app in **Slack Admin > Settings & Permissions > Calls**.
5. Invite the app to any channel where you want to place calls, or use it in DMs.

### Slack App Manifest (YAML)
```yaml
display_information:
  name: Doxy.me
  description: Internal Video Calling
  background_color: "#0b4f6c"
features:
  bot_user:
    display_name: Doxy.me
    always_online: false
  slash_commands:
    - command: /doxy-setup
      url: https://YOUR_DOMAIN/api/slack
      description: Link your Doxy.me room URL
      usage_hint: https://doxy.me/yourroom
      should_escape: false
  call_provider:
    name: Doxy.me
    calling_type: video
oauth_config:
  redirect_urls:
    - https://YOUR_DOMAIN/slack/oauth_redirect
  scopes:
    bot:
      - calls:read
      - calls:write
      - commands
      - users:read
settings:
  event_subscriptions:
    request_url: https://YOUR_DOMAIN/api/slack
    bot_events:
      - call
      - call_started
      - call_ended
  interactivity:
    is_enabled: true
    request_url: https://YOUR_DOMAIN/api/slack
```

Notes:
- `redirect_urls` is required by Slack even if you are not using OAuth flow beyond installation.
- Ensure the Call Provider is set to this app for the workspace so the phone icon triggers it.

## Usage
1. In Slack, run:
   - `/doxy-setup https://doxy.me/yourroom`
2. Click the phone icon in a DM or channel.
3. Slack will render a “Join Call” card using the Doxy.me link.

## Deployment (Vercel)
```bash
source ~/.clawdbot/secrets/vercel.env
vercel --token $VERCEL_TOKEN deploy --yes --prod
```

## Data Storage
This MVP stores user mappings in a JSON file. In Vercel, set `DATA_DIR=/tmp/doxyme-slack-calling` (default fallback) or mount a persistent volume if available. For long-term production use, migrate to Redis or Postgres.

## Scripts
- `npm run dev` - start locally
- `npm run lint` - syntax check

## Troubleshooting
- If calls don't appear, confirm the workspace Call Provider is set to this app.
- If `/doxy-setup` fails, verify the Request URL matches your Vercel domain and that `SLACK_SIGNING_SECRET` is correct.
- Ensure the bot is invited to channels where calls are initiated.
