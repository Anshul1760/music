// music-server/initDb.js
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function initDb() {
  let connection;

  try {
    console.log("⏳ Initializing database...");

    const isProduction = process.env.NODE_ENV === "production";

    if (
      !process.env.DB_HOST ||
      !process.env.DB_USER ||
      !process.env.DB_NAME
    ) {
      throw new Error("Database environment variables not set");
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      multipleStatements: true,
      connectTimeout: 30000,

      // 🔐 SSL only in production (Railway)
      ...(isProduction && {
        ssl: { rejectUnauthorized: false },
      }),
    });

    console.log("✅ DB connection successful");

    // 📄 Load SQL schema (tables only, no CREATE DATABASE)
    const sqlPath = path.join(__dirname, "database.sql");
    if (!fs.existsSync(sqlPath)) {
      throw new Error("database.sql file not found");
    }

    const sql = fs.readFileSync(sqlPath, "utf8");

    await connection.query(sql);
    console.log("✅ Tables ensured");

    // 🎵 Ensure default "Liked Songs" playlist exists
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
    console.error("❌ DB init error:", err);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

module.exports = initDb;
