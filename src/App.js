// src/App.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

const API = process.env.REACT_APP_API_URL || "";

export default function App() {
  // --- App state ---
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  const [currentYt, setCurrentYt] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- Player refs / state ---
  const [playerApiReady, setPlayerApiReady] = useState(false);
  const playerRef = useRef(null);
  const creatingRef = useRef(false);

  // recovery counters
  const recoveryAttemptsRef = useRef(0);
  const shortPauseCountRef = useRef(0);
  const playStartTimestampRef = useRef(0);
  const forceResumeRef = useRef(0);

  // user-driven playback
  const [userStartedPlayback, setUserStartedPlayback] = useState(false);

  // playtime UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);
  const [searchActive, setSearchActive] = useState(false);
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [, setHistory] = useState([]);

  const [playlists, setPlaylists] = useState([]);

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
    window.onYouTubeIframeAPIReady = () => {
      setPlayerApiReady(true);
    };
  }, []);

  // ---------------- initial data ----------------
  useEffect(() => {
    const fetchRecent = async () => {
      try {
        const res = await fetch(`${API}/api/recent`);
        if (!res.ok) {
          setRecentPlayed([]);
          return;
        }
        const data = await res.json();
        const normalized = Array.isArray(data)
          ? data.map((s) => ({
              videoId: s.videoId,
              title: s.title,
              channel: s.channel,
              thumbnail: s.thumbnail,
            }))
          : [];
        setRecentPlayed(normalized);
      } catch (err) {
        setRecentPlayed([]);
      }
    };

    const fetchPlaylists = async () => {
      try {
        const res = await fetch(`${API}/api/playlists`);
        const data = await res.json();
        if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
      } catch (err) {
        console.error(err);
      }
    };

    fetchRecent();
    fetchPlaylists();
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

  // ---------------- Player Logic ----------------
  
  const createIframeAndPlayer = useCallback((videoId) => {
    const handlePlayerReady = (event) => {
      recoveryAttemptsRef.current = 0;
      try { event.target.mute?.(); } catch { }
      try { const d = event.target.getDuration?.() || 0; setDuration(d); } catch { }
    };

    const tryRecoverPlaybackLocal = () => {
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
                if (vid) createIframeAndPlayer(vid);
              } else {
                tryRecoverPlaybackLocal();
              }
            } else {
              recoveryAttemptsRef.current = 0;
            }
          } catch {}
        }, 450);
      }, delay);
    };

    const handlePlayerStateChange = (event) => {
      const YT = window.YT;
      if (!YT) return;
      
      if (event.data === YT.PlayerState.PLAYING) {
        setIsPlaying(true);
        startTimeUpdates();
        recoveryAttemptsRef.current = 0;
        forceResumeRef.current = 0; // Reset anti-stutter
        playStartTimestampRef.current = Date.now();
        shortPauseCountRef.current = 0;
      } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
        setIsPlaying(false);
        if (event.data === YT.PlayerState.ENDED && duration) setCurrentTime(duration);
        stopTimeUpdates();

        // ANTI-STUTTER LOGIC: If it pauses within 1.5 seconds of starting
        const timeSinceStart = Date.now() - playStartTimestampRef.current;
        if (userStartedPlayback && timeSinceStart < 1500 && forceResumeRef.current < 3) {
            forceResumeRef.current += 1;
            console.warn("Detected AdBlock stutter. Force-resuming...");
            setTimeout(() => {
                try { playerRef.current.playVideo?.(); } catch(e) {}
            }, 100);
            return;
        }

        try {
          const t = playerRef.current.getCurrentTime?.() || 0;
          const sincePlay = Date.now() - (playStartTimestampRef.current || 0);
          if (userStartedPlayback && sincePlay < 4000 && t < 2) {
            shortPauseCountRef.current += 1;
            if (shortPauseCountRef.current >= 2) {
              const vid = currentYt?.videoId;
              try { playerRef.current.destroy?.(); } catch { }
              playerRef.current = null;
              shortPauseCountRef.current = 0;
              recoveryAttemptsRef.current = 0;
              setTimeout(() => { 
                if (vid) createIframeAndPlayer(vid); 
                setTimeout(() => { tryRecoverPlaybackLocal(); }, 600); 
              }, 200);
            } else {
              tryRecoverPlaybackLocal();
            }
          }
        } catch {}
      }
    };

    if (creatingRef.current) return;
    creatingRef.current = true;
    
    const container = document.getElementById("yt-player-iframe");
    if (!container) { creatingRef.current = false; return; }

    if (playerRef.current?.loadVideoById) {
      try {
        playerRef.current.loadVideoById(videoId);
        creatingRef.current = false;
        return;
      } catch {
        playerRef.current.destroy?.();
        playerRef.current = null;
      }
    }

    container.innerHTML = "";
    const instanceId = `yt-player-el-${Date.now()}`;
    const wrapper = document.createElement("div");
    wrapper.id = instanceId;
    container.appendChild(wrapper);

    requestAnimationFrame(() => {
      try {
        playerRef.current = new window.YT.Player(instanceId, {
          videoId,
          height: "160", width: "320",
          playerVars: { 
            autoplay: 0, 
            controls: 0, 
            rel: 0, 
            playsinline: 1, 
            origin: window.location.origin,
            enablejsapi: 1
          },
          events: {
            onReady: handlePlayerReady,
            onStateChange: handlePlayerStateChange,
            onError: () => tryRecoverPlaybackLocal(),
          },
        });
      } catch (err) {
        console.error("Player creation error:", err);
      } finally {
        creatingRef.current = false;
      }
    });
  }, [currentYt, userStartedPlayback, duration, startTimeUpdates, stopTimeUpdates]);

  const tryRecoverPlayback = useCallback(() => {
    if (!userStartedPlayback || !playerRef.current || !window.YT) return;
    const delay = 300;
    setTimeout(() => {
      try { playerRef.current.playVideo?.(); } catch {
        const vid = currentYt?.videoId;
        if (vid) createIframeAndPlayer(vid);
      }
    }, delay);
  }, [userStartedPlayback, currentYt, createIframeAndPlayer]);

  // ---------------- Effects ----------------
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
      try { if (playerRef.current) playerRef.current.destroy?.(); } catch (e) { }
    };
  }, [stopTimeUpdates]);

  // ---------------- Handlers ----------------
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
      setPlaylists((prev) => [...prev, { ...data, id: data.id.toString() }]);
    } catch (err) { console.error(err); }
  }, []);

  const handleRenamePlaylist = useCallback(async (id, newName) => {
    try {
      await fetch(`${API}/api/playlists/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, []);

  const handleAddSongToPlaylist = useCallback(async (playlistId, song) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}/songs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, []);

  const handleRemoveSongFromPlaylist = useCallback(async (playlistId, videoId) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}/songs/${videoId}`, { method: "DELETE" });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, []);

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    try {
      await fetch(`${API}/api/playlists/${playlistId}`, { method: "DELETE" });
      const res = await fetch(`${API}/api/playlists`);
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, []);

  const handleToggleLike = useCallback(async () => {
    if (!currentYt) return;
    try {
      await fetch(`${API}/api/liked/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentYt) });
      const plRes = await fetch(`${API}/api/playlists`);
      const plData = await plRes.json();
      if (plData.playlists) setPlaylists(plData.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, [currentYt]);

  const likedPlaylist = playlists.find((pl) => pl.isDefault);
  const isCurrentLiked = !!currentYt && !!likedPlaylist && likedPlaylist.songs.some((s) => s.videoId === currentYt.videoId);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setHistory((prev) => [...prev, { results: ytResults, query }]);
    setSearchActive(true);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      setYtResults(data.results || []);
    } catch (err) {
      alert("Error searching.");
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
    if (!playerRef.current?.getPlayerState) return;
    const state = playerRef.current.getPlayerState();
    const YT = window.YT;
    if (state === YT.PlayerState.PLAYING) {
      playerRef.current.pauseVideo();
    } else {
      if (!userStartedPlayback) {
        handleUserStartPlayback();
      } else {
        playerRef.current.playVideo();
      }
    }
  }, [userStartedPlayback, handleUserStartPlayback]);

  const handleSkipBackward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime?.() || currentTime;
    const newTime = Math.max(0, ct - 10);
    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  }, [currentTime]);

  const handleSkipForward = useCallback(() => {
    if (!playerRef.current) return;
    const dur = duration || (playerRef.current.getDuration?.() || 0);
    const ct = playerRef.current.getCurrentTime?.() || currentTime;
    const newTime = Math.min(dur, ct + 10);
    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  }, [currentTime, duration]);

  const handleTrackClick = useCallback((e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
    const newTime = percent * duration;
    playerRef.current.seekTo(newTime, true);
    setCurrentTime(newTime);
  }, [duration]);

  const formatTime = useCallback((sec) => {
    if (!sec || isNaN(sec)) return "0:00";
    const totalSeconds = Math.floor(sec);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, []);

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

          {recentPlayed.length > 0 && (
            <RecentlyPlayed recentPlayed={recentPlayed} onSelectSong={handleSelectSong} />
          )}

          {showHome ? (
            <div className="home-sections">
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
          ) : (
            <p className="status-text">Select a song from the results.</p>
          )}
        </div>
      </div>
    </div>
  );
}