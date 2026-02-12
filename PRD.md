# PRD: Doxy.me Internal Calling Integration for Slack

## 1. Executive Summary

**Product Name:** Doxy.me Connector (Internal)
**Objective:** Replace Slack Huddles/Standard calls with Doxy.me as the default calling provider for the workspace.
**Core Function:** When a user clicks the "Call" (phone) icon in Slack, the app will launch a Doxy.me session by retrieving that specific user's personal waiting room link.
**Target Audience:** Internal employees (clinicians/staff) who already have Doxy.me accounts.

## 2. User Stories

- **Setup:** As a user, I want to link my Doxy.me room URL to my Slack account once (e.g., via a slash command `/doxy-setup`) so the system knows where to send people.
- **Initiation:** As a user in a DM or Channel, I want to click the native Slack "Phone" icon and have it automatically start a call using my Doxy.me room.
- **Joining:** As a call recipient, I want to see a rich "Join Call" card in the chat window that opens the caller's Doxy.me waiting room in my browser.

## 3. Technical Architecture

### 3.1. High-Level Flow

1. **User Mapping:** The app maintains a lightweight database (SQLite/JSON/Postgres) mapping `Slack_User_ID → Doxy_Room_URL`.
2. **Call Signal:** Slack sends a `call_added` event to the app when the phone icon is clicked.
3. **Response:** The app responds by posting a "Call Block" into the chat with the initiator's Doxy.me link.

### 3.2. Tech Stack

- **Framework:** Slack Bolt SDK (Node.js)
- **Hosting:** Vercel (serverless) — use `~/clawd/scripts/vercel-deploy.sh` for deployment
- **Database:** Simple Key-Value store (JSON file for MVP, upgrade to Redis/Postgres later)

## 4. Slack App Configuration (Manifest)

### Display Information
- **App Name:** Doxy.me
- **Short Description:** Internal Video Calling
- **Icon:** Use Doxy.me logo

### OAuth & Permissions Scopes
- `calls:read` — Required to detect when a call starts
- `calls:write` — Required to post the call interface
- `commands` — For the setup slash command
- `users:read` — To get user display names

### Event Subscriptions
- `app_home_opened` (optional, for onboarding)
- The Calls API relies on the "Call Provider" registration

## 5. Functional Requirements

### Feature A: User Registration (/doxy-setup)

Since Doxy.me uses static room links (e.g., `doxy.me/drsmith`), we store the user's existing link.

**Command:** `/doxy-setup [room-url]`

**Logic:**
1. Parse the text for a valid URL (must contain doxy.me)
2. Store `{ slack_user_id: "U12345", doxy_link: "https://doxy.me/drsmith" }` in the DB
3. Respond ephemerally: "✅ Your Doxy.me room has been linked. You can now use the phone icon to start calls."

### Feature B: Handling the "Call" Button

This is the core logic. Slack treats "Calls" as a specialized object.

**Endpoint:** The app must expose an endpoint (e.g., `/slack/events`) to handle the Call Initiation.

**Logic:**
1. User clicks the phone icon → Slack checks "Global Call Provider" settings
2. If set to this app, Slack generates a unique `call_id` and sends a request to your app
3. App Action:
   - Lookup the `doxy_link` for the user initiating the call
   - If found: Call `client.calls.add`:
     - `external_unique_id`: (Generate a UUID)
     - `join_url`: (The User's Doxy.me Link)
     - `desktop_app_join_url`: (Same link)
     - `title`: "Doxy.me Call via Dr. Smith"
   - If not found: Post an ephemeral error: "Please run /doxy-setup first."

## 6. Deployment

- Deploy to Vercel using `vercel --token $VERCEL_TOKEN deploy --yes --prod`
- The VERCEL_TOKEN is available in the environment
- Ensure the app has proper HTTPS endpoints for Slack events
- Create a proper README with setup instructions

## 7. Deliverables

1. Working Node.js app with Slack Bolt SDK
2. `/doxy-setup` slash command
3. Call provider integration (calls:read, calls:write, calls.add)
4. Vercel deployment config (vercel.json)
5. README with:
   - How to create the Slack app at api.slack.com
   - Required environment variables
   - How to set as workspace call provider
6. Push to GitHub repo: `dylntrnr/doxyme-slack-calling`
