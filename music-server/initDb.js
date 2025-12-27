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

    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error("Database environment variables not set");
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      connectTimeout: 30000,
      multipleStatements: true,
      ...(isProduction && {
        ssl: { rejectUnauthorized: false },
      }),
    });

    console.log("✅ DB connection successful");

    // 📄 1. Load and execute schema
    const sqlPath = path.join(__dirname, "database.sql");
    if (!fs.existsSync(sqlPath)) {
      throw new Error("database.sql file not found");
    }

    const sql = fs.readFileSync(sqlPath, "utf8");
    await connection.query(sql);
    console.log("✅ Tables ensured");

    /* 🎵 2. Ensure default playlist
       IMPROVED LOGIC: We check by both name AND default flag 
       to prevent duplicates if the schema slightly differs.
    */
    const [rows] = await connection.query(
      "SELECT id FROM playlists WHERE is_default = 1 OR name = 'Liked Songs' LIMIT 1"
    );

    if (rows.length === 0) {
      console.log("🆕 No default playlist found. Creating 'Liked Songs'...");
      // Using user_id = 1 as per your existing logic
      await connection.query(
        "INSERT INTO playlists (user_id, name, is_default) VALUES (1, 'Liked Songs', 1)"
      );
      console.log("✅ Default 'Liked Songs' playlist created");
    } else {
      const existingId = rows[0].id;
      console.log(`ℹ️ Default playlist exists (ID: ${existingId}). Ensuring flags are correct...`);
      
      // Safety: Ensure it is actually marked as default and has the right name
      await connection.query(
        "UPDATE playlists SET is_default = 1, name = 'Liked Songs' WHERE id = ?",
        [existingId]
      );
    }

  } catch (err) {
    console.error("❌ DB init error:", err.message);

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