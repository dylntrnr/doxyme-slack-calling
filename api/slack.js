const { buildApp } = require("../src/app");

const { receiver } = buildApp();

module.exports = receiver.app;

module.exports.config = {
  api: {
    bodyParser: false
  }
};
