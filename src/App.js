import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

const API =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
    ? "http://localhost:5001"
    : `http://${window.location.hostname}:5001`);

export default function App() {
  // --- App state ---
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  
  // Persist current song on refresh
  const [currentYt, setCurrentYt] = useState(() => {
    const saved = localStorage.getItem("current_song");
    return saved ? JSON.parse(saved) : null;
  });
  
  const [loading, setLoading] = useState(false);

  // --- Player refs ---
  const playerRef = useRef(null);
  const creatingRef = useRef(false); 
  const iframeIdRef = useRef(null); 

  // --- Logic Refs ---
  const recoveryAttemptsRef = useRef(0);
  const playStartTimestampRef = useRef(0);
  const recoverBridgeRef = useRef(null); 
  const isPlayingRef = useRef(false); // Track play state without closure issues

  // --- Playback States ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false); 
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);

  // --- Lists & Navigation ---
  const [searchActive, setSearchActive] = useState(false);
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  const [playerApiReady, setPlayerApiReady] = useState(false);

  // Sync ref with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ---------------- Persist Current Song ----------------
  useEffect(() => {
    if (currentYt) {
      localStorage.setItem("current_song", JSON.stringify(currentYt));
    }
  }, [currentYt]);

  // ---------------- UI Helpers ----------------
  const formatTime = (sec) => {
    if (!sec || isNaN(sec)) return "0:00";
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // ---------------- Background Playback Fix ----------------
  useEffect(() => {
    const handleVisibilityChange = () => {
      // If the screen locks or tab switches while a song is supposed to be playing
      if (document.visibilityState === "hidden") {
        if (playerRef.current && isPlayingRef.current) {
          // Double-trigger resume for mobile browsers
          playerRef.current.playVideo?.();
          setTimeout(() => {
            if (isPlayingRef.current) playerRef.current?.playVideo?.();
          }, 200);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleVisibilityChange);
    };
  }, []);

  // ---------------- YT API loader ----------------
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setPlayerApiReady(true);
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => setPlayerApiReady(true);
  }, []);

  // ---------------- Initial Data & Playlist Logic ----------------
  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
      }
    } catch (err) {
      console.error("Error fetching playlists:", err);
    }
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const recentRes = await fetch(`${API}/api/recent`);
        const recentData = await recentRes.json();
        setRecentPlayed(Array.isArray(recentData) ? recentData : []);
        await fetchPlaylists();
      } catch (err) {
        console.error("Error loading initial data:", err);
      }
    };
    fetchInitialData();
  }, [fetchPlaylists]);

  // ---------------- Playlist Handlers ----------------
  const handleCreatePlaylist = useCallback(async (name) => {
    try {
      const res = await fetch(`${API}/api/playlists`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name })
      });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [fetchPlaylists]);

  const handleRenamePlaylist = useCallback(async (id, newName) => {
    try {
      const res = await fetch(`${API}/api/playlists/${id}`, { 
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) 
      });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [fetchPlaylists]);

  const handleAddSongToPlaylist = useCallback(async (playlistId, song) => {
    try {
      const res = await fetch(`${API}/api/playlists/${playlistId}/songs`, { 
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) 
      });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [fetchPlaylists]);

  const handleRemoveSongFromPlaylist = useCallback(async (playlistId, videoId) => {
    try {
      const res = await fetch(`${API}/api/playlists/${playlistId}/songs/${videoId}`, { method: "DELETE" });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [fetchPlaylists]);

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    try {
      const res = await fetch(`${API}/api/playlists/${playlistId}`, { method: "DELETE" });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [fetchPlaylists]);

  const handleToggleLike = useCallback(async () => {
    if (!currentYt) return;
    try {
      const res = await fetch(`${API}/api/liked/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentYt)
      });
      if (res.ok) await fetchPlaylists();
    } catch (err) {}
  }, [currentYt, fetchPlaylists]);

  // ---------------- Time Synchronization ----------------
  const stopTimeUpdates = useCallback(() => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
  }, []);

  const startTimeUpdates = useCallback(() => {
    stopTimeUpdates();
    timeIntervalRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getPlayerState) {
        const state = playerRef.current.getPlayerState();
        if (state === 1) { 
          setIsBuffering(false); 
          const ct = playerRef.current.getCurrentTime() || 0;
          const dur = playerRef.current.getDuration() || 0;
          setCurrentTime(ct);
          setDuration(dur);
        } else if (state === 3) { 
          setIsBuffering(true);
        }
      }
    }, 500);
  }, [stopTimeUpdates]);

  const handlePlayerReady = useCallback((event) => {
    recoveryAttemptsRef.current = 0;
    try { event.target.unMute?.(); } catch {}
    try { setDuration(event.target.getDuration() || 0); } catch {}
  }, []);

  const createIframeAndPlayer = useCallback((videoId) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setIsBuffering(true);
    const container = document.getElementById("yt-player-iframe");
    if (!container) { creatingRef.current = false; return; }
    if (playerRef.current && typeof playerRef.current.loadVideoById === "function") {
      try {
        playerRef.current.loadVideoById(videoId);
        playerRef.current.unMute?.();
        playerRef.current.playVideo?.();
        creatingRef.current = false;
        return;
      } catch (err) {
        try { playerRef.current.destroy?.(); } catch {}
        playerRef.current = null;
      }
    }
    container.innerHTML = "";
    const instanceId = `yt-player-el-${Date.now()}`;
    iframeIdRef.current = instanceId;
    const wrapper = document.createElement("div");
    wrapper.id = instanceId;
    wrapper.style.width = "100%"; wrapper.style.height = "100%";
    container.appendChild(wrapper);
    requestAnimationFrame(() => {
      try {
        playerRef.current = new window.YT.Player(instanceId, {
          videoId,
          height: "160", width: "320",
          playerVars: { 
            autoplay: 1, 
            controls: 0, 
            rel: 0, 
            playsinline: 1, // Crucial for mobile background
            origin: window.location.origin, 
            enablejsapi: 1 
          },
          events: {
            onReady: handlePlayerReady,
            onStateChange: (e) => recoverBridgeRef.current?.onStateChange(e),
            onError: () => recoverBridgeRef.current?.tryRecover(),
          },
        });
      } finally { creatingRef.current = false; }
    });
  }, [handlePlayerReady]);

  const tryRecoverPlayback = useCallback(() => {
    if (!playerRef.current || !window.YT) return;
    if (recoveryAttemptsRef.current >= 4) return;
    recoveryAttemptsRef.current += 1;
    setTimeout(() => {
      try { playerRef.current.unMute?.(); playerRef.current.playVideo?.(); } catch {}
    }, 500);
  }, []);

  useEffect(() => {
    recoverBridgeRef.current = {
      tryRecover: tryRecoverPlayback,
      onStateChange: (event) => {
        const YT = window.YT;
        if (!YT) return;
        if (event.data === YT.PlayerState.BUFFERING) setIsBuffering(true);
        if (event.data === YT.PlayerState.PLAYING) {
          setIsPlaying(true); setIsBuffering(false); startTimeUpdates();
          recoveryAttemptsRef.current = 0; playStartTimestampRef.current = Date.now();
        } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
          setIsPlaying(false); stopTimeUpdates();
        }
      }
    };
  }, [tryRecoverPlayback, startTimeUpdates, stopTimeUpdates]);

  useEffect(() => {
    if (!playerApiReady || !currentYt) return;
    createIframeAndPlayer(currentYt.videoId);
  }, [playerApiReady, currentYt, createIframeAndPlayer]);

  const handleSelectSong = useCallback((song) => {
    if (!song) return;
    setCurrentYt(song);
    setRecentPlayed((prev) => {
      const filtered = prev.filter((s) => s.videoId !== song.videoId);
      return [song, ...filtered].slice(0, 10);
    });
    fetch(`${API}/api/recent`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song),
    }).catch(() => {});
  }, []);

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current || !window.YT) return;
    const state = playerRef.current.getPlayerState?.();
    if (state === window.YT.PlayerState.PLAYING) playerRef.current.pauseVideo();
    else { playerRef.current.unMute(); playerRef.current.playVideo(); }
  }, []);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchActive(true); setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results) setYtResults(data.results);
    } catch (err) {} finally { setLoading(false); }
  }, [query]);

  const handleBackFromSearch = useCallback(() => {
    setSearchActive(false); setYtResults([]); setQuery("");
  }, []);

  const handleSkipBackward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime() || currentTime;
    playerRef.current.seekTo(Math.max(0, ct - 10), true);
  }, [currentTime]);

  const handleSkipForward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime() || currentTime;
    playerRef.current.seekTo(Math.min(duration, ct + 10), true);
  }, [currentTime, duration]);

  const handleTrackClick = useCallback((e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    playerRef.current.seekTo(percent * duration, true);
  }, [duration]);

  const likedPlaylist = playlists.find((pl) => pl.isDefault);
  const isCurrentLiked = !!currentYt && !!likedPlaylist && likedPlaylist.songs.some((s) => s.videoId === currentYt.videoId);
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const showHome = !loading && ytResults.length === 0 && !searchActive;
  const isPlayerActive = !!currentYt;

  return (
    <div className="app">
      <h1 className="title">🎶 My Music 🎵</h1>
      <form className="search-form" onSubmit={handleSearch}>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs..." />
        <button className="search-button" type="submit">Search</button>
      </form>
      {loading && <p className="status-text">Searching...</p>}
      <div className={`layout ${!isPlayerActive ? "layout-full" : ""}`}>
        <div className="card">
          <div className="results-header">
            {searchActive && <button type="button" className="back-button" onClick={handleBackFromSearch}>🔙</button>}
            <h2 className="results-title">Results</h2>
          </div>
          {showHome ? (
            <div className="home-sections">
              <RecentlyPlayed recentPlayed={recentPlayed} onSelectSong={handleSelectSong} isPlaying={isPlayerActive} />
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
              {ytResults.map((v) => (
                <div key={v.videoId} className="song-item yt-item" onClick={() => handleSelectSong(v)}>
                  {v.thumbnail && <img src={v.thumbnail} alt="thumb" className="yt-thumb" />}
                  <div className="yt-info">
                    <div className="song-title">{v.title}</div>
                    <div className="song-meta">{v.channel}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {currentYt && (
          <div className="card">
            <h2>Now Playing</h2>
            <div className="now-title">{currentYt.title}</div>
            <div className="now-meta">{currentYt.channel}</div>
            <div className="vibe-container">
              {isBuffering && <div className="audio-loader">Loading Audio...</div>}
              <div className={`vibe vibe-large ${isPlaying && !isBuffering ? "playing" : ""}`}>
                {[...Array(5)].map((_, i) => <span key={i} className="vibe-bar" />)}
              </div>
            </div>
            <div className="yt-player-wrapper" style={{ height: 1, width: 1, overflow: "hidden", position: "absolute", left: -9999 }}>
              <div id="yt-player-iframe" className="yt-player" />
            </div>
            <div className="track-container">
              <div className="track-time"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
              <div className="track-bar" ref={trackBarRef} onClick={handleTrackClick}>
                  <div className="track-bar-inner" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="controls">
              <button onClick={handleSkipBackward}>↩️</button>
              <button onClick={handleTogglePlay}>{isPlaying ? "⏸" : "▶"}</button>
              <button onClick={handleSkipForward}>↪️</button>
              <button onClick={handleToggleLike} className="like-btn">{isCurrentLiked ? "❤️" : "🤍"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}