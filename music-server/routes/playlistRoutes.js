// routes/playlistRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =========================================================
                     MYSQL  — PLAYLISTS
   Base path in server: /api/playlists
   So these routes become:
   - GET    /api/playlists
   - POST   /api/playlists
   - PUT    /api/playlists/:id
   - DELETE /api/playlists/:id
   - POST   /api/playlists/:id/songs
   - DELETE /api/playlists/:id/songs/:videoId
========================================================= */

// GET /api/playlists
router.get("/", async (req, res) => {
  try {
    const [playlists] = await pool.query(
      "SELECT id,name,is_default FROM playlists ORDER BY is_default DESC,created_at ASC"
    );

    const [songs] = await pool.query("SELECT * FROM playlist_songs");

    const output = playlists.map((pl) => ({
      id: pl.id.toString(),
      name: pl.name,
      isDefault: pl.is_default === 1,
      songs: songs.filter((s) => s.playlist_id === pl.id),
    }));

    res.json({ playlists: output });
  } catch (err) {
    console.error("Playlist fetch failed:", err);
    res.json({ error: "Playlist fetch failed" });
  }
});

// POST /api/playlists
router.post("/", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.json({ error: "Playlist name needed" });

  try {
    const [resDB] = await pool.query(
      "INSERT INTO playlists(name,is_default) VALUES (?,0)",
      [name.trim()]
    );

    res.json({
      id: resDB.insertId.toString(),
      name: name.trim(),
      isDefault: false,
      songs: [],
    });
  } catch (err) {
    console.error("Playlist create failed:", err);
    res.json({ error: "Playlist create failed" });
  }
});

// PUT /api/playlists/:id  (rename)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.json({ error: "Name required" });
  }

  try {
    const [result] = await pool.query(
      "UPDATE playlists SET name=? WHERE id=?",
      [name.trim(), id]
    );

    if (result.affectedRows === 0) {
      return res.json({ error: "Playlist not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Rename playlist error:", err);
    res.json({ error: "Rename failed" });
  }
});

// DELETE /api/playlists/:id  (delete)
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Check if default liked playlist
    const [rows] = await pool.query(
      "SELECT is_default FROM playlists WHERE id=?",
      [id]
    );

    if (rows.length === 0) {
      return res.json({ error: "Playlist not found" });
    }

    if (rows[0].is_default === 1) {
      return res.json({ error: "Cannot delete default Liked playlist" });
    }

    await pool.query("DELETE FROM playlists WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete playlist error:", err);
    res.json({ error: "Delete playlist failed" });
  }
});

// POST /api/playlists/:id/songs  (add song)
router.post("/:id/songs", async (req, res) => {
  const { id } = req.params;
  const { videoId, title, channel, thumbnail } = req.body;

  if (!videoId || !title) {
    return res.json({ error: "Song videoId and title required" });
  }

  try {
    await pool.query(
      `INSERT INTO playlist_songs(playlist_id,videoId,title,channel,thumbnail)
       VALUES(?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title)`,
      [id, videoId, title, channel || "", thumbnail || ""]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Adding song failed:", err);
    res.json({ error: "Adding song failed" });
  }
});

// DELETE /api/playlists/:id/songs/:videoId  (remove song)
router.delete("/:id/songs/:videoId", async (req, res) => {
  const { id, videoId } = req.params;

  try {
    await pool.query(
      "DELETE FROM playlist_songs WHERE playlist_id=? AND videoId=?",
      [id, videoId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Remove failed:", err);
    res.json({ error: "Remove failed" });
  }
});

module.exports = router;
