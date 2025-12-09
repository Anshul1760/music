// src/Playlist.jsx
import React, { useState, useMemo, useEffect } from "react";
import "./Playlist.css";

const API_BASE = "http://localhost:5001";

function Playlist({
  playlists,
  onCreatePlaylist,
  onSelectSong,
  onRenamePlaylist,
  onAddSongToPlaylist,
  onRemoveSongFromPlaylist,
  onDeletePlaylist,
  currentSong,
}) {
  const [showNewInput, setShowNewInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editName, setEditName] = useState("");

  // search inside playlist overlay
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || null,
    [playlists, activePlaylistId]
  );

  // keep editName in sync with currently active playlist
  useEffect(() => {
    if (activePlaylist) {
      setEditName(activePlaylist.name || "");
    }
  }, [activePlaylist]);

  /* ====== CREATE PLAYLIST (INLINE INPUT) ====== */
  const handleNewPlaylist = () => {
    setShowNewInput(true);
  };

  const handleCreate = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    onCreatePlaylist && onCreatePlaylist(name);
    setNewPlaylistName("");
    setShowNewInput(false);
  };

  const handleCancelNew = () => {
    setNewPlaylistName("");
    setShowNewInput(false);
  };

  /* ====== OPEN / CLOSE OVERLAY ====== */
  const handleOpenPlaylist = (pl) => {
    setActivePlaylistId(pl.id);
    setOverlayOpen(true);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleCloseOverlay = () => {
    setOverlayOpen(false);
    setActivePlaylistId(null);
    setSearchQuery("");
    setSearchResults([]);
  };

  /* ====== PLAY SONG FROM PLAYLIST ====== */
  const handlePlaySong = (song) => {
    onSelectSong && onSelectSong(song);
  };

  /* ====== RENAME PLAYLIST ====== */
  const handleSaveName = () => {
    if (!activePlaylist) return;
    const name = editName.trim();
    if (!name) return;
    if (onRenamePlaylist) {
      onRenamePlaylist(activePlaylist.id, name);
    }
  };

  /* ====== REMOVE SONG FROM PLAYLIST ====== */
  const handleRemoveSong = (song) => {
    if (!activePlaylist) return;
    if (onRemoveSongFromPlaylist) {
      onRemoveSongFromPlaylist(activePlaylist.id, song.videoId);
    }
  };

  /* ====== ADD CURRENT PLAYING SONG TO THIS PLAYLIST ====== */
  const handleAddCurrentSong = () => {
    if (!activePlaylist || !currentSong) return;
    if (onAddSongToPlaylist) {
      onAddSongToPlaylist(activePlaylist.id, currentSong);
    }
  };

  /* ====== SEARCH INSIDE OVERLAY TO ADD SONGS ====== */
  const handleSearchInside = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/youtube/search?query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Playlist search error:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddFromSearch = (song) => {
    if (!activePlaylist) return;
    if (onAddSongToPlaylist) {
      onAddSongToPlaylist(activePlaylist.id, song);
    }
  };

  /* ====== DELETE PLAYLIST (HOME LIST ICON) ====== */
  const handleDeleteClick = (e, pl) => {
    e.stopPropagation(); // don't open overlay
    if (!onDeletePlaylist) return;
    setDeleteTarget(pl);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget && onDeletePlaylist) {
      onDeletePlaylist(deleteTarget.id);
    }
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
  };

  return (
    <>
      {/* Sidebar / section with playlist names + counts */}
      <div className="playlist-section">
        <div className="playlist-header">
          <h3 className="playlist-title">Playlists</h3>
          {!showNewInput && (
            <button
              type="button"
              className="playlist-new-btn"
              onClick={handleNewPlaylist}
            >
              + New
            </button>
          )}
        </div>

        {/* Inline create playlist row */}
        {showNewInput && (
          <div className="playlist-new-row">
            <input
              type="text"
              className="playlist-new-input"
              placeholder="Playlist name..."
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
            />
            <button
              type="button"
              className="playlist-new-create"
              onClick={handleCreate}
            >
              Create
            </button>
            <button
              type="button"
              className="playlist-new-cancel"
              onClick={handleCancelNew}
            >
              ✕
            </button>
          </div>
        )}

        {playlists.length === 0 ? (
          <p className="playlist-empty">No playlists yet.</p>
        ) : (
          <div className="playlist-list">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className="playlist-item"
                onClick={() => handleOpenPlaylist(pl)}
              >
                <div className="playlist-main">
                  <span className="playlist-name">{pl.name}</span>
                  <div className="playlist-main-right">
                    {pl.isDefault && (
                      <span className="playlist-badge-liked">Liked</span>
                    )}
                    {/* delete icon */}
                    {!pl.isDefault && (
                      <button
                        className="playlist-delete-btn"
                        onClick={(e) => handleDeleteClick(e, pl)}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                <div className="playlist-meta">
                  {pl.songs?.length || 0} song
                  {(pl.songs?.length || 0) !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full playlist overlay */}
      {overlayOpen && activePlaylist && (
        <div className="playlist-overlay">
          <div className="playlist-overlay-content">
            <div className="playlist-overlay-header">
              <button
                type="button"
                className="playlist-overlay-back"
                onClick={handleCloseOverlay}
              >
                ← Back
              </button>

              <div className="playlist-overlay-title-block">
                <input
                  className="playlist-edit-name-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <button
                  type="button"
                  className="playlist-edit-name-save"
                  onClick={handleSaveName}
                >
                  Save name
                </button>
                {activePlaylist.isDefault && (
                  <span className="playlist-edit-badge-readonly">
                    (Default liked playlist)
                  </span>
                )}
              </div>
            </div>

            {/* Add current playing song */}
            {currentSong && (
              <div className="playlist-add-current-row">
                <span className="playlist-add-current-label">
                  Current: {currentSong.title}
                </span>
                <button
                  type="button"
                  className="playlist-add-current-btn"
                  onClick={handleAddCurrentSong}
                >
                  + Add current song
                </button>
              </div>
            )}

            {/* Search bar to add new songs */}
            <form
              className="playlist-search-row"
              onSubmit={handleSearchInside}
            >
              <input
                className="playlist-search-input"
                placeholder="Search songs to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="playlist-search-btn">
                🔍
              </button>
            </form>

            {/* Search results with + icon */}
            {searchLoading && (
              <div className="playlist-search-loading">Searching...</div>
            )}
            {searchResults.length > 0 && !searchLoading && (
              <div className="playlist-search-results">
                {searchResults.map((song) => (
                  <div key={song.videoId} className="playlist-search-item">
                    {song.thumbnail && (
                      <img
                        src={song.thumbnail}
                        alt={song.title}
                        className="playlist-search-thumb"
                      />
                    )}
                    <div className="playlist-search-info">
                      <div className="playlist-song-title">{song.title}</div>
                      <div className="playlist-song-meta">{song.channel}</div>
                    </div>
                    <button
                      type="button"
                      className="playlist-search-add"
                      onClick={() => handleAddFromSearch(song)}
                    >
                      ➕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Songs in this playlist */}
            <div className="playlist-overlay-list">
              {!activePlaylist.songs || activePlaylist.songs.length === 0 ? (
                <p className="playlist-empty">No songs in this playlist.</p>
              ) : (
                activePlaylist.songs.map((song) => (
                  <div key={song.videoId} className="playlist-overlay-item">
                    {song.thumbnail && (
                      <img
                        src={song.thumbnail}
                        alt={song.title}
                        className="playlist-overlay-thumb"
                        onClick={() => handlePlaySong(song)}
                      />
                    )}
                    <div
                      className="playlist-overlay-info"
                      onClick={() => handlePlaySong(song)}
                    >
                      <div className="playlist-song-title">{song.title}</div>
                      <div className="playlist-song-meta">{song.channel}</div>
                    </div>
                    <button
                      type="button"
                      className="playlist-overlay-remove"
                      onClick={() => handleRemoveSong(song)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🗑 Custom delete confirmation dialog */}
      {showDeleteConfirm && deleteTarget && (
        <div className="playlist-delete-overlay">
          <div className="playlist-delete-dialog">
            <h4 className="playlist-delete-title">Delete playlist</h4>
            <p className="playlist-delete-text">
              Are you sure you want to delete{" "}
              <span className="playlist-delete-name">
                “{deleteTarget.name}”
              </span>
              ? This action cannot be undone.
            </p>
            <div className="playlist-delete-actions">
              <button
                type="button"
                className="playlist-delete-cancel"
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="playlist-delete-confirm"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Playlist;
