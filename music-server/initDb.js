// music-server/initDb.js
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function initDb(retries = 5) {
  let connection;

  try {
    console.log("⏳ Initializing database...");

    const isProduction = process.env.NODE_ENV === "production";

    // 🔒 Basic env validation
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error("Database environment variables not set");
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      // ⚠️ IMPORTANT: DO NOT FORCE PORT ON RAILWAY
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,

      connectTimeout: 30000,
      multipleStatements: true,

      // 🔐 SSL required for Railway
      ...(isProduction && {
        ssl: { rejectUnauthorized: false },
      }),
    });

    console.log("✅ DB connection successful");

    // 📄 Load schema
    const sqlPath = path.join(__dirname, "database.sql");
    if (!fs.existsSync(sqlPath)) {
      throw new Error("database.sql file not found");
    }

    const sql = fs.readFileSync(sqlPath, "utf8");

    await connection.query(sql);
    console.log("✅ Tables ensured");

    // 🎵 Ensure default playlist
    const [rows] = await connection.query(
      "SELECT id FROM playlists WHERE user_id = 1 AND is_default = 1 LIMIT 1"
    );

    if (rows.length === 0) {
      await connection.query(
        "INSERT INTO playlists (user_id, name, is_default) VALUES (1, 'Liked Songs', 1)"
      );
      console.log("✅ Default 'Liked Songs' playlist created");
    } else {
      console.log("ℹ️ Default playlist already exists");
    }
  } catch (err) {
    console.error("❌ DB init error:", err.message);

    // 🔁 RETRY (CRITICAL FOR RAILWAY)
    if (retries > 0) {
      console.log(`🔁 Retrying DB init (${retries} retries left) in 5s...`);
      await sleep(5000);
      return initDb(retries - 1);
    } else {
      console.error("❌ DB init failed after retries");
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

module.exports = initDb;
