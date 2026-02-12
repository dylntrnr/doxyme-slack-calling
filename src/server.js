const { buildApp } = require("./app");

async function start() {
  const { app } = buildApp();
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`Doxy.me Slack Calling app listening on port ${port}`);
}

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
