// music-server/server.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const initDb = require("./initDb");
const axios = require("axios");
const pool = require("./db"); // MySQL connection file (must read envs inside)
const playlistRoutes = require("./routes/playlistRoutes"); // router for playlists

const app = express();

// === CONFIG ===
// prefer environment variable for API key in production
const YT_API_KEY = process.env.YT_API_KEY ;
if (!YT_API_KEY) {
  console.warn("⚠️ YT_API_KEY is not set. /api/youtube/search will fail.");
}


// allowed origins list (comma-separated env or defaults)
let allowedOrigins;
if (typeof process.env.ALLOWED_ORIGINS === "string" && process.env.ALLOWED_ORIGINS.trim() !== "") {
  allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
} else if (Array.isArray(process.env.ALLOWED_ORIGINS)) {
  allowedOrigins = process.env.ALLOWED_ORIGINS;
} else {
  allowedOrigins = [
    "https://music123-three.vercel.app/",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
}

console.log("Allowed origins:", allowedOrigins);

// CORS configuration: allow no-origin requests (curl, server-to-server),
// allow configured origins, otherwise do NOT set CORS headers.
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Do not allow origin
      return callback(null, false);
    },
    optionsSuccessStatus: 200,
  })
);

// If an incoming request is from a disallowed origin, return JSON 403 for API calls
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "CORS policy: origin not allowed" });
    }
  }
  next();
});

app.use(express.json());

// 🔹 Initialize DB (create tables if missing)
initDb();


// ================== HEALTH CHECK ==================
app.get("/", (req, res) => {
  res.send("🎵 YouTube Music + MySQL API Running");
});

// ================== YOUTUBE SEARCH (improved logging + retry) ==================
app.get("/api/youtube/search", async (req, res) => {
  const query = req.query.query || "";

  if (!query) return res.status(400).json({ error: "Missing query param" });

  const ytUrl = "https://www.googleapis.com/youtube/v3/search";
  const params = {
    key: YT_API_KEY,
    q: query,
    part: "snippet",
    maxResults: 15,
    type: "video",
  };

  const doRequest = async () => {
    return await axios.get(ytUrl, { params, timeout: 10000 });
  };

  try {
    console.log(`[YT SEARCH] query="${query}" from=${req.get("origin") || "no-origin"}`);

    let response;
    try {
      response = await doRequest();
    } catch (firstErr) {
      const transient =
        firstErr.code === "ECONNABORTED" ||
        firstErr.code === "ENOTFOUND" ||
        firstErr.code === "ECONNRESET" ||
        !firstErr.response;
      if (transient) {
        console.warn("[YT SEARCH] first attempt failed (transient). Retrying once...", firstErr.code || firstErr.message);
        try {
          response = await doRequest();
        } catch (secondErr) {
          throw secondErr;
        }
      } else {
        throw firstErr;
      }
    }

    const results = (response.data.items || []).map((item) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      channel: item.snippet?.channelTitle,
      thumbnail: item.snippet?.thumbnails?.medium?.url,
    }));

    return res.json({ query, results });
  } catch (err) {
    console.error("[YT SEARCH] Error calling YouTube API:");
    console.error("  message:", err.message);
    if (err.code) console.error("  code:", err.code);
    if (err.config && err.config.url) console.error("  request url:", err.config.url);

    if (err.response) {
      console.error("  status:", err.response.status);
      try {
        console.error("  response data:", JSON.stringify(err.response.data).slice(0, 2000));
      } catch (e) {
        console.error("  response data (inspect manually):", err.response.data);
      }
      // Return details from Google to help debugging (safe for dev)
      return res.status(err.response.status || 500).json({
        error: "YouTube API Failed",
        details: err.response.data || null,
      });
    }

    return res.status(500).json({ error: "YouTube API Failed", details: err.message || "unknown" });
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
    res.json(rows);
  } catch (err) {
    console.error("Recent fetch failed:", err);
    res.status(500).json({ error: "Recent fetch failed" });
  }
});

app.post("/api/recent", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: "Missing data" });

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
    res.status(500).json({ error: "Recent save failed" });
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
  if (!videoId || !title) return res.status(400).json({ error: "Missing fields" });

  try {
    const [row] = await pool.query("SELECT id FROM playlists WHERE is_default=1 LIMIT 1");

    let likedId;
    if (!row || row.length === 0) {
      const [newPL] = await pool.query(
        "INSERT INTO playlists(name,is_default)VALUES('Liked Songs',1)"
      );
      likedId = newPL.insertId;
    } else {
      likedId = row[0].id;
    }

    const [exists] = await pool.query(
      "SELECT id FROM playlist_songs WHERE playlist_id=? AND videoId=?",
      [likedId, videoId]
    );

    if (exists.length > 0) {
      await pool.query("DELETE FROM playlist_songs WHERE playlist_id=? AND videoId=?", [likedId, videoId]);
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
    res.status(500).json({ error: "Like toggle failed" });
  }
});

/* =========================================================
                     ERROR HANDLER (JSON)
========================================================= */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

// Export the app so it can be used by a serverless wrapper (e.g. serverless-http)
module.exports = app;

// Only start listening when run directly (local dev)
if (require.main === module) {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(` Backend Running → http://localhost:${PORT}`);
  });
}
