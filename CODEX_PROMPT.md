Read PRD.md carefully. Build the ENTIRE Doxy.me Slack Calling Integration app described in it. Do NOT stop until everything is complete and deployed.

REQUIREMENTS:
1. Build a Node.js app using Slack Bolt SDK that registers as a Slack Call Provider
2. Implement /doxy-setup slash command for users to link their doxy.me room URL
3. Implement the calls.add integration so clicking the phone icon in Slack starts a doxy.me call
4. Use a JSON file for the user mapping database (MVP)
5. Create vercel.json for Vercel deployment
6. Create a comprehensive README with setup instructions for creating the Slack app at api.slack.com
7. Include the Slack app manifest YAML in the README
8. Create a GitHub repo at dylntrnr/doxyme-slack-calling and push all code

DEPLOYMENT:
- Use the vercel CLI with: source ~/.clawdbot/secrets/vercel.env && vercel --token $VERCEL_TOKEN deploy --yes --prod
- Also push to GitHub: gh repo create dylntrnr/doxyme-slack-calling --public --source . --push

IMPORTANT:
- This must be production-ready code, not a skeleton
- Include proper error handling, logging, and edge cases
- The Slack Calls API uses calls.add, calls.update, calls.end methods
- Test that the code at least passes a syntax/lint check before deploying
- Do NOT stop until the code is built, pushed to GitHub, and deployed to Vercel

When completely finished, run this command to notify me:
openclaw system event --text "Done: Doxy.me Slack Calling app built, pushed to GitHub, and deployed to Vercel" --mode now
