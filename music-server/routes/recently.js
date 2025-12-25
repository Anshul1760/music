// music-server/routes/recently.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/* ================================
   GET /api/recent
================================ */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT videoId, title, channel, thumbnail
       FROM recent_played
       ORDER BY played_at DESC
       LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /recent error:", err);
    res.status(500).json({ error: "Failed to fetch recent songs" });
  }
});

/* ================================
   POST /api/recent
================================ */
router.post("/", async (req, res) => {
  const { videoId, title, channel, thumbnail } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: "videoId required" });
  }

  try {
    await pool.query(
      `INSERT INTO recent_played (videoId, title, channel, thumbnail)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         channel = VALUES(channel),
         thumbnail = VALUES(thumbnail),
         played_at = CURRENT_TIMESTAMP`,
      [videoId, title || "", channel || "", thumbnail || ""]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST /recent error:", err);
    res.status(500).json({ error: "Failed to save recent song" });
  }
});

module.exports = router;
