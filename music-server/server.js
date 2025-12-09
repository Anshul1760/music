// server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const pool = require("./db"); // MySQL connection file
const playlistRoutes = require("./routes/playlistRoutes"); // ✅ new routes file

const app = express();
const PORT = 5001;

// 🔥 Your YouTube Data API Key
const YT_API_KEY = "key";

app.use(cors());
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
    console.error("YouTube API Error:", err.message);
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
// All routes starting with /api/playlists handled in routes/playlistRoutes.js
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
                     START SERVER
========================================================= */
app.listen(PORT, () => {
  console.log(` Backend Running → http://localhost:${PORT}`);
});
