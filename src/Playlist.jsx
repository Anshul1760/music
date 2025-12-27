import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import "./Playlist.css";

/* =====================================================
   CONFIGURATION
===================================================== */

const INITIAL_CHUNK_SIZE = 25;
const LOAD_MORE_THRESHOLD = 200;

/* =====================================================
   PLAYLIST COMPONENT
===================================================== */

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

  /* =====================================================
     SIDEBAR STATE
  ===================================================== */

  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  /* =====================================================
     PAGE NAVIGATION STATE
  ===================================================== */

  const [activePlaylistId, setActivePlaylistId] = useState(null);

  /* =====================================================
     PLAYLIST EDIT STATE
  ===================================================== */

  const [editableName, setEditableName] = useState("");

  /* =====================================================
     SEARCH STATE
  ===================================================== */

  const [searchQuery, setSearchQuery] = useState("");

  /* =====================================================
     INFINITE SCROLL STATE
  ===================================================== */

  const [visibleCount, setVisibleCount] = useState(
    INITIAL_CHUNK_SIZE
  );
  const songScrollRef = useRef(null);

  /* =====================================================
     DELETE CONFIRM STATE
  ===================================================== */

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] =
    useState(false);

  /* =====================================================
     DERIVED ACTIVE PLAYLIST
  ===================================================== */

  const activePlaylist = useMemo(() => {
    if (!activePlaylistId) return null;
    return (
      playlists.find(
        (playlist) => playlist.id === activePlaylistId
      ) || null
    );
  }, [playlists, activePlaylistId]);

  /* =====================================================
     FILTERED SONGS
  ===================================================== */

  const filteredSongs = useMemo(() => {
    if (!activePlaylist) return [];

    if (!searchQuery.trim()) {
      return activePlaylist.songs;
    }

    const query = searchQuery.toLowerCase();

    return activePlaylist.songs.filter((song) =>
      song.title.toLowerCase().includes(query)
    );
  }, [activePlaylist, searchQuery]);

  /* =====================================================
     VISIBLE SONGS (INFINITE SCROLL)
  ===================================================== */

  const visibleSongs = useMemo(() => {
    return filteredSongs.slice(0, visibleCount);
  }, [filteredSongs, visibleCount]);

  /* =====================================================
     EFFECTS
  ===================================================== */

  useEffect(() => {
    if (!activePlaylist) return;

    setEditableName(activePlaylist.name);
    setSearchQuery("");
    setVisibleCount(INITIAL_CHUNK_SIZE);
  }, [activePlaylist]);

  /* =====================================================
     HANDLERS — NAVIGATION
  ===================================================== */

  const openPlaylistPage = (playlist) => {
    setActivePlaylistId(playlist.id);
  };

  const goBackToSidebar = () => {
    setActivePlaylistId(null);
    setVisibleCount(INITIAL_CHUNK_SIZE);
  };

  /* =====================================================
     HANDLERS — CREATE PLAYLIST
  ===================================================== */

  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim();

    if (!name) return;

    if (onCreatePlaylist) {
      onCreatePlaylist(name);
    }

    setNewPlaylistName("");
    setShowCreateInput(false);
  };

  /* =====================================================
     HANDLERS — RENAME PLAYLIST
  ===================================================== */

  const handleRenamePlaylist = () => {
    if (!activePlaylist) return;
    if (activePlaylist.isDefault) return;

    const name = editableName.trim();

    if (!name) return;

    if (onRenamePlaylist) {
      onRenamePlaylist(activePlaylist.id, name);
    }
  };

  /* =====================================================
     HANDLERS — SONG ACTIONS
  ===================================================== */

  const handlePlaySong = (song) => {
    if (onSelectSong) {
      onSelectSong(song);
    }
  };

  const handleAddCurrentSong = () => {
    if (!activePlaylist) return;
    if (!currentSong) return;

    if (onAddSongToPlaylist) {
      onAddSongToPlaylist(
        activePlaylist.id,
        currentSong
      );
    }
  };

  const handleRemoveSong = (song) => {
    if (!activePlaylist) return;

    if (onRemoveSongFromPlaylist) {
      onRemoveSongFromPlaylist(
        activePlaylist.id,
        song.videoId
      );
    }
  };

  /* =====================================================
     INFINITE SCROLL HANDLER
  ===================================================== */

  const handleSongScroll = useCallback(() => {
    const el = songScrollRef.current;
    if (!el) return;

    const scrolledToBottom =
      el.scrollTop + el.clientHeight >=
      el.scrollHeight - LOAD_MORE_THRESHOLD;

    if (scrolledToBottom) {
      setVisibleCount((prev) =>
        Math.min(
          prev + INITIAL_CHUNK_SIZE,
          filteredSongs.length
        )
      );
    }
  }, [filteredSongs.length]);

  /* =====================================================
     DELETE PLAYLIST HANDLERS
  ===================================================== */

  const askDeletePlaylist = (playlist, event) => {
    event.stopPropagation();
    setDeleteTarget(playlist);
    setShowDeleteConfirm(true);
  };

  const confirmDeletePlaylist = () => {
    if (!deleteTarget) return;

    if (onDeletePlaylist) {
      onDeletePlaylist(deleteTarget.id);
    }

    if (deleteTarget.id === activePlaylistId) {
      setActivePlaylistId(null);
    }

    setDeleteTarget(null);
    setShowDeleteConfirm(false);
  };

  /* =====================================================
     RENDER — SIDEBAR VIEW
  ===================================================== */

  if (!activePlaylist) {
    return (
      <div className="playlist-page">

        {/* HEADER */}
        <div className="playlist-header">
          <h2 className="playlist-title">
            Your Playlists
          </h2>

          {!showCreateInput && (
            <button
              className="playlist-new-btn"
              onClick={() =>
                setShowCreateInput(true)
              }
            >
              + New
            </button>
          )}
        </div>

        {/* CREATE PLAYLIST */}
        {showCreateInput && (
          <div className="playlist-new-row">
            <input
              className="playlist-new-input"
              placeholder="Playlist name"
              value={newPlaylistName}
              onChange={(e) =>
                setNewPlaylistName(e.target.value)
              }
            />
            <button
              className="playlist-new-create"
              onClick={handleCreatePlaylist}
            >
              Create
            </button>
            <button
              className="playlist-new-cancel"
              onClick={() =>
                setShowCreateInput(false)
              }
            >
              ✕
            </button>
          </div>
        )}

        {/* PLAYLIST LIST */}
        <div className="playlist-list">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="playlist-item"
              onClick={() =>
                openPlaylistPage(playlist)
              }
            >
              <div className="playlist-main">
                <span className="playlist-name">
                  {playlist.name}
                </span>

                {!playlist.isDefault && (
                  <button
                    className="playlist-delete-btn"
                    onClick={(e) =>
                      askDeletePlaylist(
                        playlist,
                        e
                      )
                    }
                  >
                    🗑
                  </button>
                )}
              </div>

              <div className="playlist-meta">
                {playlist.songs.length} songs
              </div>
            </div>
          ))}
        </div>

        {/* DELETE CONFIRM */}
        {showDeleteConfirm && (
          <div className="playlist-delete-overlay">
            <div className="playlist-delete-dialog">
              <h4>Delete playlist?</h4>
              <p>
                Are you sure you want to delete{" "}
                <strong>
                  {deleteTarget?.name}
                </strong>
                ?
              </p>
              <div className="playlist-delete-actions">
                <button
                  onClick={() =>
                    setShowDeleteConfirm(false)
                  }
                >
                  Cancel
                </button>
                <button
                  onClick={
                    confirmDeletePlaylist
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  /* =====================================================
     RENDER — FULL PAGE PLAYLIST VIEW
  ===================================================== */

  return (
    <div className="playlist-page">

      {/* TOP BAR */}
      <div className="playlist-page-top">
        <button
          className="playlist-back-btn"
          onClick={goBackToSidebar}
        >
          ← Back
        </button>

        <input
          className="playlist-title-input"
          value={editableName}
          onChange={(e) =>
            setEditableName(e.target.value)
          }
          onBlur={handleRenamePlaylist}
        />
      </div>

      {/* ADD CURRENT SONG */}
      {currentSong && (
        <div className="playlist-add-current">
          <span className="playlist-add-current-label">
            Current: {currentSong.title}
          </span>
          <button
            className="playlist-add-current-btn"
            onClick={handleAddCurrentSong}
          >
            + Add current
          </button>
        </div>
      )}

      {/* SEARCH */}
      <div className="playlist-search">
        <input
          placeholder="Search in playlist..."
          value={searchQuery}
          onChange={(e) =>
            setSearchQuery(e.target.value)
          }
        />
      </div>

      {/* SONG LIST */}
      <div
        className="playlist-songs"
        ref={songScrollRef}
        onScroll={handleSongScroll}
      >
        {visibleSongs.map((song) => (
          <div
            key={song.videoId}
            className="playlist-song"
          >
            <img
              src={song.thumbnail}
              alt=""
              onClick={() =>
                handlePlaySong(song)
              }
            />

            <div
              className="playlist-song-info"
              onClick={() =>
                handlePlaySong(song)
              }
            >
              <div className="title">
                {song.title}
              </div>
              <div className="meta">
                {song.channel}
              </div>
            </div>

            <button
              className="remove"
              onClick={() =>
                handleRemoveSong(song)
              }
            >
              ✕
            </button>
          </div>
        ))}

        {visibleCount <
          filteredSongs.length && (
          <div className="playlist-load-more">
            Loading more songs…
          </div>
        )}
      </div>

    </div>
  );
}

export default Playlist;
