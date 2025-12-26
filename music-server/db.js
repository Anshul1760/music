const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // 🔴 IMPORTANT: prevents empty results on Railway cold start
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  // 🔐 Railway MySQL requires SSL
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : undefined,
});

module.exports = pool;
