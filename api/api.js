// api/index.js
const serverless = require("serverless-http");
const app = require("../music-server/server"); 

module.exports = app;
module.exports.handler = serverless(app);
