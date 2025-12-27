import React, { useState, useMemo, useEffect } from "react";
import "./Playlist.css";

// Dynamic API URL logic to prevent Mixed Content errors
const API_BASE = process.env.REACT_APP_API_URL || 
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5001" 
    : `http://${window.location.hostname}:5001`); 
    // Note: If you have a deployed backend (Railway/Render), 
    // you should put that HTTPS URL in REACT_APP_API_URL in Vercel settings.

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

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || null,
    [playlists, activePlaylistId]
  );

  useEffect(() => {
    if (activePlaylist) {
      setEditName(activePlaylist.name || "");
    }
  }, [activePlaylist]);

  const handleNewPlaylist = () => setShowNewInput(true);

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

  const handleOpenPlaylist = (pl) => {
    setActivePlaylistId(pl.id);
    setOverlayOpen(true);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleCloseOverlay = () => {
    setOverlayOpen(false);
    setActivePlaylistId(null);
  };

  const handlePlaySong = (song) => {
    onSelectSong && onSelectSong(song);
  };

  const handleSaveName = () => {
    if (!activePlaylist || activePlaylist.isDefault) return;
    const name = editName.trim();
    if (!name) return;
    if (onRenamePlaylist) onRenamePlaylist(activePlaylist.id, name);
  };

  /* ====== FIXED REMOVE LOGIC ====== */
  const handleRemoveSong = async (song) => {
    if (!activePlaylist) return;

    if (activePlaylist.isDefault) {
      try {
        // Use the same toggle endpoint as the Heart button
        const res = await fetch(`${API_BASE}/api/liked/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(song),
        });
        
        if (res.ok && onRemoveSongFromPlaylist) {
          // Notify parent to refresh the state
          onRemoveSongFromPlaylist(activePlaylist.id, song.videoId);
        }
      } catch (err) {
        console.error("Error unliking song:", err);
      }
    } else {
      if (onRemoveSongFromPlaylist) {
        onRemoveSongFromPlaylist(activePlaylist.id, song.videoId);
      }
    }
  };

  const handleAddCurrentSong = () => {
    if (!activePlaylist || !currentSong) return;
    onAddSongToPlaylist && onAddSongToPlaylist(activePlaylist.id, currentSong);
  };

  const handleSearchInside = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/youtube/search?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddFromSearch = (song) => {
    if (!activePlaylist) return;
    onAddSongToPlaylist && onAddSongToPlaylist(activePlaylist.id, song);
  };

  const handleDeleteClick = (e, pl) => {
    e.stopPropagation();
    if (pl.isDefault) return;
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

  return (
    <>
      <div className="playlist-section">
        <div className="playlist-header">
          <h3 className="playlist-title">Playlists</h3>
          {!showNewInput && (
            <button type="button" className="playlist-new-btn" onClick={handleNewPlaylist}>+ New</button>
          )}
        </div>

        {showNewInput && (
          <div className="playlist-new-row">
            <input
              type="text"
              className="playlist-new-input"
              placeholder="Name..."
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
            />
            <button type="button" className="playlist-new-create" onClick={handleCreate}>Create</button>
            <button type="button" className="playlist-new-cancel" onClick={handleCancelNew}>✕</button>
          </div>
        )}

        <div className="playlist-list">
          {playlists.map((pl) => (
            <div key={pl.id} className="playlist-item" onClick={() => handleOpenPlaylist(pl)}>
              <div className="playlist-main">
                <span className="playlist-name">{pl.name}</span>
                <div className="playlist-main-right">
                  {pl.isDefault && <span className="playlist-badge-liked">Liked</span>}
                  {!pl.isDefault && (
                    <button className="playlist-delete-btn" onClick={(e) => handleDeleteClick(e, pl)}>🗑</button>
                  )}
                </div>
              </div>
              <div className="playlist-meta">
                {pl.songs?.length || 0} song{pl.songs?.length !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {overlayOpen && activePlaylist && (
        <div className="playlist-overlay">
          <div className="playlist-overlay-content">
            <div className="playlist-overlay-header">
              <button type="button" className="playlist-overlay-back" onClick={handleCloseOverlay}>🔙</button>
              <div className="playlist-overlay-title-block">
                <input
                  className="playlist-edit-name-input"
                  value={editName}
                  readOnly={activePlaylist.isDefault}
                  onChange={(e) => setEditName(e.target.value)}
                />
                {!activePlaylist.isDefault && (
                  <button type="button" className="playlist-edit-name-save" onClick={handleSaveName}>Save</button>
                )}
              </div>
            </div>

            {currentSong && (
              <div className="playlist-add-current-row">
                <span className="playlist-add-current-label">Current: {currentSong.title}</span>
                <button type="button" className="playlist-add-current-btn" onClick={handleAddCurrentSong}>+ Add current</button>
              </div>
            )}

            <form className="playlist-search-row" onSubmit={handleSearchInside}>
              <input
                className="playlist-search-input"
                placeholder="Search songs to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="playlist-search-btn">🔍</button>
            </form>

            {searchLoading && <div className="playlist-search-loading">Searching...</div>}
            
            <div className="playlist-search-results">
              {searchResults.map((song) => (
                <div key={song.videoId} className="playlist-search-item">
                  {song.thumbnail && <img src={song.thumbnail} alt="" className="playlist-search-thumb" />}
                  <div className="playlist-search-info">
                    <div className="playlist-song-title">{song.title}</div>
                  </div>
                  <button type="button" className="playlist-search-add" onClick={() => handleAddFromSearch(song)}>➕</button>
                </div>
              ))}
            </div>

            <div className="playlist-overlay-list">
              {activePlaylist.songs?.map((song) => (
                <div key={song.videoId} className="playlist-overlay-item">
                  {song.thumbnail && (
                    <img 
                      src={song.thumbnail} 
                      alt="" 
                      className="playlist-overlay-thumb" 
                      onClick={() => handlePlaySong(song)} 
                    />
                  )}
                  <div className="playlist-overlay-info" onClick={() => handlePlaySong(song)}>
                    <div className="playlist-song-title">{song.title}</div>
                    <div className="playlist-song-meta">{song.channel}</div>
                  </div>
                  <button type="button" className="playlist-overlay-remove" onClick={() => handleRemoveSong(song)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="playlist-delete-overlay">
          <div className="playlist-delete-dialog">
            <h4>Delete playlist?</h4>
            <div className="playlist-delete-actions">
              <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="playlist-delete-confirm" onClick={handleConfirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Playlist;