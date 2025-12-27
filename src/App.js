// src/App.jsx
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
    : "");

export default function App() {
  // --- App state ---
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  const [currentYt, setCurrentYt] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- Player refs ---
  const playerRef = useRef(null);
  const creatingRef = useRef(false); 
  const instantiateTimerRef = useRef(null); 
  const iframeIdRef = useRef(null); 

  // --- Logic Refs (To prevent dependency loops) ---
  const recoveryAttemptsRef = useRef(0);
  const shortPauseCountRef = useRef(0);
  const playStartTimestampRef = useRef(0);
  const recoverBridgeRef = useRef(null); // Bridges the circular dependency

  // user-driven playback
  const [userStartedPlayback, setUserStartedPlayback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);

  // app lists
  const [searchActive, setSearchActive] = useState(false);
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [, setHistory] = useState([]); // Kept to satisfy state structure if needed

  // --- Player API Ready ---
  const [playerApiReady, setPlayerApiReady] = useState(false);

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

  // ---------------- initial data ----------------
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [recentRes, playlistsRes] = await Promise.all([
          fetch(`${API}/api/recent`),
          fetch(`${API}/api/playlists`),
        ]);
        const recentData = await recentRes.json();
        const playlistsData = await playlistsRes.json();
        setRecentPlayed(Array.isArray(recentData) ? recentData : []);
        if (playlistsData.playlists) {
          setPlaylists(playlistsData.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
        }
      } catch (err) {
        console.error("Error loading initial data:", err);
      }
    };
    fetchInitialData();
  }, []);

  // ---------------- time updates ----------------
  const stopTimeUpdates = useCallback(() => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
  }, []);

  const startTimeUpdates = useCallback(() => {
    stopTimeUpdates();
    timeIntervalRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getDuration) {
        const ct = playerRef.current.getCurrentTime ? playerRef.current.getCurrentTime() : 0;
        const dur = playerRef.current.getDuration ? playerRef.current.getDuration() : 0;
        setCurrentTime(ct || 0);
        setDuration(dur || 0);
      }
    }, 500);
  }, [stopTimeUpdates]);

  // ---------------- Handlers ----------------

  const handlePlayerReady = useCallback((event) => {
    recoveryAttemptsRef.current = 0;
    try { event.target.mute?.(); } catch {}
    try { const d = event.target.getDuration?.() || 0; setDuration(d); } catch {}
  }, []);

  const createIframeAndPlayer = useCallback((videoId) => {
    if (creatingRef.current) return;
    creatingRef.current = true;

    if (instantiateTimerRef.current) clearTimeout(instantiateTimerRef.current);

    const container = document.getElementById("yt-player-iframe");
    if (!container) {
      creatingRef.current = false;
      return;
    }

    if (playerRef.current && typeof playerRef.current.loadVideoById === "function") {
      try {
        playerRef.current.loadVideoById(videoId);
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
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    container.appendChild(wrapper);

    requestAnimationFrame(() => {
      try {
        playerRef.current = new window.YT.Player(instanceId, {
          videoId,
          height: "160",
          width: "320",
          playerVars: { autoplay: 0, controls: 0, rel: 0, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: handlePlayerReady,
            onStateChange: (e) => recoverBridgeRef.current?.onStateChange(e),
            onError: () => recoverBridgeRef.current?.tryRecover(),
          },
        });
      } finally {
        creatingRef.current = false;
      }
    });
  }, [handlePlayerReady]);

  const tryRecoverPlayback = useCallback(() => {
    if (!userStartedPlayback || !playerRef.current || !window.YT) return;
    if (recoveryAttemptsRef.current >= 4) return;

    recoveryAttemptsRef.current += 1;
    const delay = 300 * recoveryAttemptsRef.current;

    setTimeout(() => {
      try { playerRef.current.playVideo?.(); } catch {}
      setTimeout(() => {
        try {
          const state = playerRef.current.getPlayerState?.();
          if (state !== window.YT.PlayerState.PLAYING) {
            if (recoveryAttemptsRef.current >= 3) {
              const vid = currentYt?.videoId;
              try { playerRef.current.destroy?.(); } catch {}
              playerRef.current = null;
              recoveryAttemptsRef.current = 0;
              setTimeout(() => { if (vid) createIframeAndPlayer(vid); }, 200);
            } else {
              tryRecoverPlayback();
            }
          }
        } catch {}
      }, 450);
    }, delay);
  }, [userStartedPlayback, currentYt, createIframeAndPlayer]);

  // Set the Bridge so the Player can call recovery logic
  useEffect(() => {
    recoverBridgeRef.current = {
      tryRecover: tryRecoverPlayback,
      onStateChange: (event) => {
        const YT = window.YT;
        if (!YT) return;
        if (event.data === YT.PlayerState.PLAYING) {
          setIsPlaying(true);
          startTimeUpdates();
          recoveryAttemptsRef.current = 0;
          playStartTimestampRef.current = Date.now();
          shortPauseCountRef.current = 0;
        } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
          setIsPlaying(false);
          stopTimeUpdates();
          try {
            const t = playerRef.current.getCurrentTime?.() || 0;
            const sincePlay = Date.now() - playStartTimestampRef.current;
            if (userStartedPlayback && sincePlay < 4000 && t < 2) {
              shortPauseCountRef.current += 1;
              if (shortPauseCountRef.current >= 2) {
                const vid = currentYt?.videoId;
                try { playerRef.current.destroy?.(); } catch {}
                playerRef.current = null;
                shortPauseCountRef.current = 0;
                recoveryAttemptsRef.current = 0;
                setTimeout(() => { if (vid) createIframeAndPlayer(vid); }, 200);
              } else {
                tryRecoverPlayback();
              }
            }
          } catch {}
        }
      }
    };
  }, [tryRecoverPlayback, createIframeAndPlayer, startTimeUpdates, stopTimeUpdates, userStartedPlayback, currentYt]);

  // ---------------- lifecycle ----------------
  useEffect(() => {
    if (!playerApiReady || !currentYt) return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    recoveryAttemptsRef.current = 0;
    shortPauseCountRef.current = 0;
    setUserStartedPlayback(false);
    createIframeAndPlayer(currentYt.videoId);
  }, [playerApiReady, currentYt, createIframeAndPlayer]);

  useEffect(() => {
    return () => {
      stopTimeUpdates();
      try { playerRef.current?.destroy?.(); } catch {}
    };
  }, [stopTimeUpdates]);

  // ---------------- handlers ----------------
  const handleUserStartPlayback = useCallback(() => {
    if (!playerRef.current) return;
    try {
      playerRef.current.unMute?.();
      playerRef.current.playVideo?.();
      setUserStartedPlayback(true);
    } catch (e) {
      tryRecoverPlayback();
    }
  }, [tryRecoverPlayback]);

  const handleSelectSong = useCallback((song) => {
    if (!song) return;
    setCurrentYt(song);
    setRecentPlayed((prev) => {
      const filtered = prev.filter((s) => s.videoId !== song.videoId);
      return [song, ...filtered].slice(0, 10);
    });
    fetch(`${API}/api/recent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(song),
    }).catch(() => {});
  }, []);

  const handleCreatePlaylist = useCallback(async (name) => {
    try {
      const res = await fetch(`${API}/api/playlists`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.id) setPlaylists((prev) => [...prev, { ...data, id: data.id.toString() }]);
    } catch (err) {}
  }, []);

  const handleRenamePlaylist = useCallback(async (id, newName) => {
    try {
      await fetch(`${API}/api/playlists/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) {}
  }, []);

  const handleAddSongToPlaylist = useCallback(async (playlistId, song) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}/songs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) {}
  }, []);

  const handleRemoveSongFromPlaylist = useCallback(async (playlistId, videoId) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}/songs/${videoId}`, { method: "DELETE" });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) {}
  }, []);

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}`, { method: "DELETE" });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) {}
  }, []);

  const handleToggleLike = useCallback(async () => {
    if (!currentYt) return;
    try {
      await fetch(`${API}/api/liked/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentYt) });
      const plRes = await fetch(`${API}/api/playlists`);
      const plData = await plRes.json();
      if (plData.playlists) setPlaylists(plData.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) {}
  }, [currentYt]);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setHistory((prev) => [...prev, { results: ytResults, query }]);
    setSearchActive(true);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results) setYtResults(data.results);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, [query, ytResults]);

  const handleBackFromSearch = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) { setSearchActive(false); setYtResults([]); return prev; }
      const newHistory = [...prev];
      const last = newHistory.pop();
      setYtResults(last.results || []);
      setQuery(last.query || "");
      setSearchActive(newHistory.length > 0);
      return newHistory;
    });
  }, []);

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current || !window.YT) return;
    const state = playerRef.current.getPlayerState?.();
    if (state === window.YT.PlayerState.PLAYING) {
      playerRef.current.pauseVideo?.();
    } else {
      if (!userStartedPlayback) {
        handleUserStartPlayback();
      } else {
        playerRef.current.playVideo?.();
      }
    }
  }, [userStartedPlayback, handleUserStartPlayback]);

  const handleSkipBackward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime?.() || currentTime;
    playerRef.current.seekTo?.(Math.max(0, ct - 10), true);
  }, [currentTime]);

  const handleSkipForward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime?.() || currentTime;
    playerRef.current.seekTo?.(Math.min(duration, ct + 10), true);
  }, [currentTime, duration]);

  const handleTrackClick = useCallback((e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    playerRef.current.seekTo?.(percent * duration, true);
  }, [duration]);

  const formatTime = (sec) => {
    if (!sec || isNaN(sec)) return "0:00";
    const totalSeconds = Math.floor(sec);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const likedPlaylist = playlists.find((pl) => pl.isDefault);
  const isCurrentLiked = !!currentYt && !!likedPlaylist && likedPlaylist.songs.some((s) => s.videoId === currentYt.videoId);
  const progressPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const showHome = !loading && ytResults.length === 0 && !searchActive;

  return (
    <div className="app">
      <h1 className="title">🎶 My Music 🎵</h1>
      <form className="search-form" onSubmit={handleSearch}>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs..." />
        <button className="search-button" type="submit">Search</button>
      </form>
      {loading && <p className="status-text">Searching...</p>}
      <div className="layout">
        <div className="card">
          <div className="results-header">
            {searchActive && <button type="button" className="back-button" onClick={handleBackFromSearch}>🔙</button>}
            <h2 className="results-title">Results</h2>
          </div>
          {showHome ? (
            <div className="home-sections">
              <RecentlyPlayed recentPlayed={recentPlayed} onSelectSong={handleSelectSong} />
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
        <div className="card">
          <h2>Now Playing</h2>
          {currentYt ? (
            <>
              <div className="now-title">{currentYt.title}</div>
              <div className="now-meta">{currentYt.channel}</div>
              <div className={`vibe vibe-large ${isPlaying ? "playing" : ""}`}>
                {[...Array(5)].map((_, i) => <span key={i} className="vibe-bar" />)}
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
                <button onClick={handleToggleLike}>{isCurrentLiked ? "❤️" : "🤍"}</button>
              </div>
            </>
          ) : <p className="status-text">Select a song from the results.</p>}
        </div>
      </div>
    </div>
  );
}