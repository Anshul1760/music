const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =========================================================
   PLAYLIST ROUTES  — Base: /api/playlists
========================================================= */

// GET /api/playlists
router.get("/", async (req, res) => {
  try {
    const [playlists] = await pool.query(
      `SELECT id, name, is_default
       FROM playlists
       ORDER BY is_default DESC, created_at ASC`
    );

    const [songs] = await pool.query(
      `SELECT playlist_id, videoId, title, channel, thumbnail
       FROM playlist_songs`
    );

    const output = playlists.map((pl) => ({
      id: String(pl.id),
      name: pl.name,
      isDefault: pl.is_default === 1,
      songs: songs
        .filter((s) => s.playlist_id === pl.id)
        .map((s) => ({
          videoId: s.videoId,
          title: s.title,
          channel: s.channel,
          thumbnail: s.thumbnail,
        })),
    }));

    res.json({ playlists: output });
  } catch (err) {
    console.error("Playlist fetch failed:", err);
    res.status(500).json({ error: "Playlist fetch failed" });
  }
});

// POST /api/playlists
router.post("/", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: "Playlist name needed" });
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO playlists (name, is_default) VALUES (?, 0)",
      [name.trim()]
    );

    res.status(201).json({
      id: String(result.insertId),
      name: name.trim(),
      isDefault: false,
      songs: [],
    });
  } catch (err) {
    console.error("Playlist create failed:", err);
    res.status(500).json({ error: "Playlist create failed" });
  }
});

// PUT /api/playlists/:id
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "Name required" });
  }

  try {
    const [result] = await pool.query(
      "UPDATE playlists SET name=? WHERE id=?",
      [name.trim(), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Rename playlist error:", err);
    res.status(500).json({ error: "Rename failed" });
  }
});

// DELETE /api/playlists/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      "SELECT is_default FROM playlists WHERE id=?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    if (rows[0].is_default === 1) {
      return res
        .status(403)
        .json({ error: "Cannot delete default Liked playlist" });
    }

    await pool.query("DELETE FROM playlists WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete playlist error:", err);
    res.status(500).json({ error: "Delete playlist failed" });
  }
});

// POST /api/playlists/:id/songs
router.post("/:id/songs", async (req, res) => {
  const { id } = req.params;
  const { videoId, title, channel, thumbnail } = req.body;

  if (!videoId || !title) {
    return res
      .status(400)
      .json({ error: "videoId and title required" });
  }

  try {
    await pool.query(
      `INSERT INTO playlist_songs
       (playlist_id, videoId, title, channel, thumbnail)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         channel = VALUES(channel),
         thumbnail = VALUES(thumbnail)`,
      [id, videoId, title, channel || "", thumbnail || ""]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Adding song failed:", err);
    res.status(500).json({ error: "Adding song failed" });
  }
});

// DELETE /api/playlists/:id/songs/:videoId
router.delete("/:id/songs/:videoId", async (req, res) => {
  const { id, videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "videoId required" });
  }

  try {
    await pool.query(
      "DELETE FROM playlist_songs WHERE playlist_id=? AND videoId=?",
      [id, videoId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Remove failed:", err);
    res.status(500).json({ error: "Remove failed" });
  }
});

module.exports = router;
