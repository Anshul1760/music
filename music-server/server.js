// music-server/server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const pool = require("./db"); // MySQL connection file
const playlistRoutes = require("./routes/playlistRoutes"); // router for playlists

const app = express();

// === CONFIG ===
// prefer environment variable for API key in production
const YT_API_KEY = process.env.YT_API_KEY || "AIzaSyC4zWxUX9kNFzxEYx8HcWAL_d5SP_wLzQ8";

// Configure CORS: allow your Vercel frontend + localhost (dev)
const allowedOrigins = [
  "https://musicmy-kappa.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (e.g. mobile apps, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy: origin not allowed"));
      }
    },
  })
);

app.use(express.json());

// ================== HEALTH CHECK ==================
app.get("/", (req, res) => {
  res.send("🎵 YouTube Music + MySQL API Running");
});

// ================== YOUTUBE SEARCH ==================
app.get("/api/youtube/search", async (req, res) => {
  const query = req.query.query || "";
  try {
    const ytUrl = "https://www.googleapis.com/youtube/v3/search";
    const response = await axios.get(ytUrl, {
      params: {
        key: YT_API_KEY,
        q: query,
        part: "snippet",
        maxResults: 15,
        type: "video",
      },
    });

    const results = response.data.items.map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url,
    }));

    res.json({ query, results });
  } catch (err) {
    console.error("YouTube API Error:", err.message || err);
    res.status(500).json({ error: "YouTube API Failed" });
  }
});

/* =========================================================
                     MYSQL  — RECENTLY PLAYED
========================================================= */
app.get("/api/recent", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT videoId, title, channel, thumbnail FROM recent_played ORDER BY played_at DESC LIMIT 10"
    );
    res.json({ recent: rows });
  } catch (err) {
    console.error("Recent fetch failed:", err);
    res.status(500).json({ error: "Recent fetch failed" });
  }
});

app.post("/api/recent", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;
  if (!videoId || !title) return res.json({ error: "Missing data" });

  try {
    await pool.query(
      `INSERT INTO recent_played (videoId,title,channel,thumbnail)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE played_at=CURRENT_TIMESTAMP`,
      [videoId, title, channel || "", thumbnail || ""]
    );

    await pool.query(
      `DELETE FROM recent_played 
       WHERE id NOT IN(
         SELECT id FROM(
           SELECT id FROM recent_played ORDER BY played_at DESC LIMIT 20
         ) as t
       )`
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Recent save failed:", err);
    res.json({ error: "Recent save failed" });
  }
});

/* =========================================================
                     MYSQL  — PLAYLISTS (via router)
========================================================= */
app.use("/api/playlists", playlistRoutes);

/* =========================================================
                      LIKE / UNLIKE SYSTEM
========================================================= */
app.post("/api/liked/toggle", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;
  if (!videoId || !title) return res.json({ error: "Missing fields" });

  try {
    // Ensure default "Liked Songs" playlist exists
    let [row] = await pool.query(
      "SELECT id FROM playlists WHERE is_default=1 LIMIT 1"
    );

    let likedId;

    if (row.length === 0) {
      const [newPL] = await pool.query(
        "INSERT INTO playlists(name,is_default)VALUES('Liked Songs',1)"
      );
      likedId = newPL.insertId;
    } else {
      likedId = row[0].id;
    }

    // Check if song already liked
    const [exists] = await pool.query(
      "SELECT id FROM playlist_songs WHERE playlist_id=? AND videoId=?",
      [likedId, videoId]
    );

    if (exists.length > 0) {
      await pool.query(
        "DELETE FROM playlist_songs WHERE playlist_id=? AND videoId=?",
        [likedId, videoId]
      );
      return res.json({ liked: false });
    } else {
      await pool.query(
        "INSERT INTO playlist_songs(playlist_id,videoId,title,channel,thumbnail) VALUES(?,?,?,?,?)",
        [likedId, videoId, title, channel, thumbnail]
      );
      return res.json({ liked: true });
    }
  } catch (err) {
    console.error("Like toggle failed:", err);
    res.json({ error: "Like toggle failed" });
  }
});

/* =========================================================
                     EXPORT / START SERVER
========================================================= */

// Export the app so it can be used by a serverless wrapper (e.g. serverless-http)
module.exports = app;

// Only start listening when run directly (local dev)
if (require.main === module) {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(` Backend Running → http://localhost:${PORT}`);
  });
}
