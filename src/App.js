import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

const API_BASE = "http://localhost:5001";

function App() {
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  const [currentYt, setCurrentYt] = useState(null);
  const [loading, setLoading] = useState(false);

  const [playerApiReady, setPlayerApiReady] = useState(false);
  const playerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);

  // For multi-level back in search
  const [history, setHistory] = useState([]); // array of { results, query }
  const [searchActive, setSearchActive] = useState(false);

  // Recently played and playlists (from MySQL)
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setPlayerApiReady(true);
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      setPlayerApiReady(true);
    };
  }, []);

  // Load recent + playlists from backend once
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [recentRes, playlistsRes] = await Promise.all([
          fetch(`${API_BASE}/api/recent`),
          fetch(`${API_BASE}/api/playlists`),
        ]);

        const recentData = await recentRes.json();
        const playlistsData = await playlistsRes.json();

        setRecentPlayed(recentData.recent || []);

        if (playlistsData.playlists) {
          setPlaylists(
            playlistsData.playlists.map((pl) => ({
              ...pl,
              id: pl.id.toString(), // ensure string IDs in frontend
            }))
          );
        }
      } catch (err) {
        console.error("Error loading initial data:", err);
      }
    };

    fetchInitialData();
  }, []);

  const stopTimeUpdates = () => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
  };

  const startTimeUpdates = () => {
    stopTimeUpdates();
    timeIntervalRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getDuration) {
        const ct = playerRef.current.getCurrentTime() || 0;
        const dur = playerRef.current.getDuration() || 0;
        setCurrentTime(ct);
        setDuration(dur);
      }
    }, 500);
  };

  // Player event handlers
  const handlePlayerReady = (event) => {
    const dur = event.target.getDuration() || 0;
    setDuration(dur);
  };

  const handlePlayerStateChange = (event) => {
    const YT = window.YT;
    if (!YT) return;

    if (event.data === YT.PlayerState.PLAYING) {
      setIsPlaying(true);
      startTimeUpdates();
    } else if (
      event.data === YT.PlayerState.PAUSED ||
      event.data === YT.PlayerState.ENDED
    ) {
      setIsPlaying(false);
      if (event.data === YT.PlayerState.ENDED && duration) {
        setCurrentTime(duration);
      }
      stopTimeUpdates();
    }
  };

  // When current video changes, load it into the player and AUTOPLAY
  useEffect(() => {
    if (!playerApiReady || !currentYt) return;

    const videoId = currentYt.videoId;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      // Autoplay when user clicked a song
      playerRef.current.playVideo();
    } else {
      playerRef.current = new window.YT.Player("yt-player-iframe", {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
        },
        events: {
          onReady: handlePlayerReady,
          onStateChange: handlePlayerStateChange,
        },
      });
    }
  }, [playerApiReady, currentYt]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimeUpdates();
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Select a song (from results, recent, playlist) + update recentPlayed (local + DB)
  const handleSelectSong = (song) => {
    if (!song) return;
    setCurrentYt(song);

    // update UI immediately
    setRecentPlayed((prev) => {
      const filtered = prev.filter((s) => s.videoId !== song.videoId);
      const updated = [song, ...filtered];
      return updated.slice(0, 10); // keep only 10
    });

    // sync to backend (no await needed for UI)
    fetch(`${API_BASE}/api/recent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(song),
    }).catch((err) => console.error("Error saving recent:", err));
  };

  // Create new playlist (with backend)
  const handleCreatePlaylist = async (name) => {
    try {
      const res = await fetch(`${API_BASE}/api/playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();

      if (data.error) {
        console.error("Create playlist error:", data.error);
        alert(data.error);
        return;
      }

      setPlaylists((prev) => [...prev, { ...data, id: data.id.toString() }]);
    } catch (err) {
      console.error("Error creating playlist:", err);
    }
  };

  // Rename playlist (safe for 204 / empty responses)
  const handleRenamePlaylist = async (id, newName) => {
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });

      if (!res.ok) {
        console.error("Rename playlist failed, status:", res.status);
        alert("Failed to rename playlist");
        return;
      }

      // Try to read JSON only if there is a response body
      const text = await res.text();
      if (text) {
        try {
          const data = JSON.parse(text);
          if (data.error) {
            console.error("Rename playlist error:", data.error);
            alert(data.error);
            return;
          }
        } catch (parseErr) {
          console.warn("Rename response not valid JSON (probably fine):", parseErr);
        }
      }

      // Always refetch playlists after successful rename
      const res2 = await fetch(`${API_BASE}/api/playlists`);
      const data2 = await res2.json();
      if (data2.playlists) {
        setPlaylists(
          data2.playlists.map((pl) => ({ ...pl, id: pl.id.toString() }))
        );
      }
    } catch (err) {
      console.error("Rename playlist failed:", err);
      alert("Error renaming playlist. Check console for details.");
    }
  };

  // Add song to playlist
  const handleAddSongToPlaylist = async (playlistId, song) => {
    try {
      await fetch(`${API_BASE}/api/playlists/${playlistId}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(song),
      });

      const res = await fetch(`${API_BASE}/api/playlists`);
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(
          data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() }))
        );
      }
    } catch (err) {
      console.error("Add song to playlist failed:", err);
    }
  };

  // Remove song from playlist
  const handleRemoveSongFromPlaylist = async (playlistId, videoId) => {
    try {
      await fetch(`${API_BASE}/api/playlists/${playlistId}/songs/${videoId}`, {
        method: "DELETE",
      });

      const res = await fetch(`${API_BASE}/api/playlists`);
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(
          data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() }))
        );
      }
    } catch (err) {
      console.error("Remove song from playlist failed:", err);
    }
  };

  // Delete playlist (safe for 204 / empty responses)
  const handleDeletePlaylist = async (playlistId) => {
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlistId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        console.error("Delete playlist failed, status:", res.status);
        alert("Failed to delete playlist");
        return;
      }

      // If backend returns 204 or empty body, we don't parse JSON
      // If backend returns JSON, we can optionally read it:
      // const text = await res.text();
      // if (text) {
      //   const data = JSON.parse(text);
      //   if (data.error) {
      //     console.error("Delete playlist error:", data.error);
      //     alert(data.error);
      //     return;
      //   }
      // }

      // After successful delete, refresh playlists
      const res2 = await fetch(`${API_BASE}/api/playlists`);
      const data2 = await res2.json();
      if (data2.playlists) {
        setPlaylists(
          data2.playlists.map((pl) => ({ ...pl, id: pl.id.toString() }))
        );
      }
    } catch (err) {
      console.error("Delete playlist failed:", err);
      alert("Error deleting playlist. Check console for details.");
    }
  };

  // 👉 Toggle Like / Unlike current song (via backend)
  const handleToggleLike = async () => {
    if (!currentYt) return;

    try {
      const res = await fetch(`${API_BASE}/api/liked/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentYt),
      });

      const data = await res.json();
      if (data.error) {
        console.error("Like toggle error:", data.error);
        return;
      }

      // refresh playlists to reflect latest liked state
      const plRes = await fetch(`${API_BASE}/api/playlists`);
      const plData = await plRes.json();
      if (plData.playlists) {
        setPlaylists(
          plData.playlists.map((pl) => ({ ...pl, id: pl.id.toString() }))
        );
      }
    } catch (err) {
      console.error("Error toggling like:", err);
    }
  };

  // Compute whether current track is liked (from playlists from DB)
  const likedPlaylist = playlists.find((pl) => pl.isDefault);
  const isCurrentLiked =
    !!currentYt &&
    !!likedPlaylist &&
    likedPlaylist.songs.some((s) => s.videoId === currentYt.videoId);

  // Search YouTube (affects only left list)
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Push current results & query into history for multi-level back
    setHistory((prev) => [...prev, { results: ytResults, query }]);
    setSearchActive(true);

    setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/youtube/search?query=${encodeURIComponent(query)}`
      );
      const data = await res.json();

      if (data.error) {
        console.error("YouTube backend error:", data.error);
        alert(data.error);
        setLoading(false);
        return;
      }

      setYtResults(data.results || []);
      // Do NOT touch currentYt, so current song keeps playing
    } catch (err) {
      console.error("Error searching YouTube:", err);
      alert("Error searching. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  // Multi-level back
  const handleBackFromSearch = () => {
    setHistory((prev) => {
      if (prev.length === 0) {
        setSearchActive(false);
        setYtResults([]);
        return prev;
      }

      const newHistory = [...prev];
      const last = newHistory.pop();

      setYtResults(last.results || []);
      setQuery(last.query || "");

      if (newHistory.length === 0) {
        setSearchActive(false);
      } else {
        setSearchActive(true);
      }

      return newHistory;
    });
  };

  // Single Play/Pause toggle button
  const handleTogglePlay = () => {
    if (!playerRef.current || !window.YT) return;

    const state = playerRef.current.getPlayerState();
    if (state === window.YT.PlayerState.PLAYING) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const handleSkipBackward = () => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime
      ? playerRef.current.getCurrentTime()
      : currentTime;
    const newTime = Math.max(0, ct - 10);
    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  };

  const handleSkipForward = () => {
    if (!playerRef.current) return;
    const dur = duration || (playerRef.current.getDuration?.() || 0);
    const ct = playerRef.current.getCurrentTime
      ? playerRef.current.getCurrentTime()
      : currentTime;
    const newTime = Math.min(dur, ct + 10);
    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  };

  // Click on progress bar to seek
  const handleTrackClick = (e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;

    const rect = trackBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
    const newTime = percent * duration;

    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  };

  const formatTime = (sec) => {
    if (!sec || isNaN(sec)) return "0:00";
    const totalSeconds = Math.floor(sec);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const progressPercent =
    duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  // Show home (recent + playlists) when nothing searched
  const showHome = !loading && ytResults.length === 0 && !searchActive;

  return (
    <div className="app">
      <h1 className="title">🎶 My Music 🎵</h1>

      {/* Search bar */}
      <form className="search-form" onSubmit={handleSearch}>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists..."
        />
        <button className="search-button" type="submit">
          Search
        </button>
      </form>

      {loading && <p className="status-text">Searching...</p>}

      <div className="layout">
        {/* LEFT: Results / Home sections */}
        <div className="card">
          <div className="results-header">
            {searchActive && (
              <button
                type="button"
                className="back-button"
                onClick={handleBackFromSearch}
              >
                ← Back
              </button>
            )}
            <h2 className="results-title">Results</h2>
          </div>

          {showHome ? (
            <div className="home-sections">
              <RecentlyPlayed
                recentPlayed={recentPlayed}
                onSelectSong={handleSelectSong}
              />
              <Playlist
                playlists={playlists}
                onCreatePlaylist={handleCreatePlaylist}
                onSelectSong={handleSelectSong}
                onRenamePlaylist={handleRenamePlaylist}
                onAddSongToPlaylist={handleAddSongToPlaylist}
                onRemoveSongFromPlaylist={handleRemoveSongFromPlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                currentSong={currentYt}
              />
            </div>
          ) : (
            <div className="song-list">
              {!loading && ytResults.length === 0 && searchActive && (
                <p className="status-text">
                  No results yet. Try another search.
                </p>
              )}
              {ytResults.map((v) => (
                <div
                  key={v.videoId}
                  className="song-item yt-item"
                  onClick={() => handleSelectSong(v)} // select + autoplay + add to recent + save in DB
                >
                  {v.thumbnail && (
                    <img src={v.thumbnail} alt="thumb" className="yt-thumb" />
                  )}
                  <div className="yt-info">
                    <div className="song-title">{v.title}</div>
                    <div className="song-meta">{v.channel}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Player */}
        <div className="card">
          <h2>Now Playing</h2>
          {currentYt ? (
            <>
              <div className="now-title">{currentYt.title}</div>
              <div className="now-meta">{currentYt.channel}</div>

              {/* Big centered 5-bar vibration animation */}
              <div className={`vibe vibe-large ${isPlaying ? "playing" : ""}`}>
                <span className="vibe-bar" />
                <span className="vibe-bar" />
                <span className="vibe-bar" />
                <span className="vibe-bar" />
                <span className="vibe-bar" />
              </div>

              <div className="yt-player-wrapper">
                {/* IFrame Player API will create iframe inside this div */}
                <div id="yt-player-iframe" className="yt-player"></div>
              </div>

              {/* Song tracking line */}
              <div className="track-container">
                <div className="track-time">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div
                  className="track-bar"
                  ref={trackBarRef}
                  onClick={handleTrackClick}
                >
                  <div
                    className="track-bar-inner"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Controls: back 10s, play/pause, forward 10s, like */}
              <div className="controls">
                <button onClick={handleSkipBackward}>↩️</button>
                <button onClick={handleTogglePlay}>
                  {isPlaying ? "⏸" : "▶"}
                </button>
                <button onClick={handleSkipForward}>↪️</button>
                <button onClick={handleToggleLike}>
                  {isCurrentLiked ? "❤️" : "🤍"}
                </button>
              </div>
            </>
          ) : (
            <p className="status-text">Select a song from the results.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
