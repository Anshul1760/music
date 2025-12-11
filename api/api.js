const serverless = require("serverless-http");
const app = require("../music-server/server");

// Export ONLY the serverless handler for Vercel
module.exports = serverless(app);
