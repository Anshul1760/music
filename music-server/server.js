// music-server/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const pool = require("./db");
const playlistRoutes = require("./routes/playlistRoutes");

const app = express();

/* =========================================================
                        CONFIG
========================================================= */

const YT_API_KEY = process.env.YT_API_KEY;

let allowedOrigins;
if (process.env.ALLOWED_ORIGINS) {
  allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim());
} else {
  allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://musicmy-kappa.vercel.app",
  ];
}

console.log("✅ Allowed origins:", allowedOrigins);

/* =========================================================
                        CORS
========================================================= */

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server / curl
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* =========================================================
                    JSON MIDDLEWARE
========================================================= */

app.use(express.json());

/* =========================================================
                      HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.send("🎵 YouTube Music + MySQL API Running");
});

/* =========================================================
                    YOUTUBE SEARCH
========================================================= */

app.get("/api/youtube/search", async (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ error: "Missing query" });

  try {
    const response = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          key: YT_API_KEY,
          q: query,
          part: "snippet",
          maxResults: 15,
          type: "video",
        },
        timeout: 10000,
      }
    );

    const results = (response.data.items || []).map(item => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      channel: item.snippet?.channelTitle,
      thumbnail: item.snippet?.thumbnails?.medium?.url,
    }));

    res.json({ query, results });
  } catch (err) {
    console.error("❌ YouTube API error:", err.message);
    res.status(500).json({ error: "YouTube API failed" });
  }
});

/* =========================================================
                RECENTLY PLAYED
========================================================= */

app.get("/api/recent", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT videoId,title,channel,thumbnail FROM recent_played ORDER BY played_at DESC LIMIT 10"
    );
    res.json({ recent: rows });
  } catch (err) {
    console.error("❌ Recent fetch failed:", err);
    res.status(500).json({ error: "Recent fetch failed" });
  }
});

app.post("/api/recent", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: "Missing data" });

  try {
    await pool.query(
      `INSERT INTO recent_played(videoId,title,channel,thumbnail)
       VALUES(?,?,?,?)
       ON DUPLICATE KEY UPDATE played_at=CURRENT_TIMESTAMP`,
      [videoId, title, channel || "", thumbnail || ""]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Recent save failed:", err);
    res.status(500).json({ error: "Recent save failed" });
  }
});

/* =========================================================
                    PLAYLIST ROUTES
========================================================= */

app.use("/api/playlists", playlistRoutes);

/* =========================================================
                    LIKE / UNLIKE
========================================================= */

app.post("/api/liked/toggle", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: "Missing fields" });

  try {
    const [rows] = await pool.query(
      "SELECT id FROM playlists WHERE is_default=1 LIMIT 1"
    );

    let playlistId = rows.length ? rows[0].id : null;

    if (!playlistId) {
      const [result] = await pool.query(
        "INSERT INTO playlists(name,is_default) VALUES('Liked Songs',1)"
      );
      playlistId = result.insertId;
    }

    const [exists] = await pool.query(
      "SELECT id FROM playlist_songs WHERE playlist_id=? AND videoId=?",
      [playlistId, videoId]
    );

    if (exists.length) {
      await pool.query(
        "DELETE FROM playlist_songs WHERE playlist_id=? AND videoId=?",
        [playlistId, videoId]
      );
      return res.json({ liked: false });
    }

    await pool.query(
      "INSERT INTO playlist_songs(playlist_id,videoId,title,channel,thumbnail) VALUES(?,?,?,?,?)",
      [playlistId, videoId, title, channel, thumbnail]
    );

    res.json({ liked: true });
  } catch (err) {
    console.error("❌ Like toggle failed:", err);
    res.status(500).json({ error: "Like toggle failed" });
  }
});

/* =========================================================
                  ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("❌ Server error:", err.message);
  res.status(500).json({ error: err.message || "Server error" });
});

/* =========================================================
                    START SERVER
========================================================= */

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(`✅ Backend running → http://localhost:${PORT}`);
  });
}
