// src/App.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

const API = process.env.REACT_APP_API_URL;

export default function App() {
  // --- App state ---
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  const [currentYt, setCurrentYt] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- Player refs / state ---
  const [playerApiReady, setPlayerApiReady] = useState(false);
  const playerRef = useRef(null);
  const creatingRef = useRef(false); // prevents concurrent create
  const instantiateTimerRef = useRef(null); // a single timer for fallback instantiation
  const iframeIdRef = useRef(null); // current iframe id

  // recovery counters
  const recoveryAttemptsRef = useRef(0);
  const shortPauseCountRef = useRef(0);
  const playStartTimestampRef = useRef(0);

  // user-driven playback
  const [userStartedPlayback, setUserStartedPlayback] = useState(false);

  // playtime UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);

  // app lists
  const [history, setHistory] = useState([]);
  const [searchActive, setSearchActive] = useState(false);
  const [recentPlayed, setRecentPlayed] = useState([]);
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
      console.log("[YT] API ready");
      setPlayerApiReady(true);
    };
    return () => {
      // leave API loaded
    };
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

const normalizedRecent = Array.isArray(recentData)
  ? recentData.map((s) => ({
      videoId: s.videoId,
      title: s.title,
      channel: s.channel,
      thumbnail: s.thumbnail,
    }))
  : [];

setRecentPlayed(normalizedRecent);

        const playlistsData = await playlistsRes.json();
        
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

  // ---------------- recovery ----------------
  const tryRecoverPlayback = useCallback(() => {
    if (!userStartedPlayback || !playerRef.current || !window.YT) return;

    const MAX = 4;
    const RECREATE_AFTER = 3;
    if (recoveryAttemptsRef.current >= MAX) {
      console.warn("[RECOVER] max attempts reached");
      return;
    }

    recoveryAttemptsRef.current += 1;
    const attempt = recoveryAttemptsRef.current;
    const delay = 300 * attempt;
    console.warn(`[RECOVER] attempt #${attempt} in ${delay}ms`);

    setTimeout(() => {
      try {
        playerRef.current.playVideo?.();
      } catch (e) {
        console.warn("[RECOVER] playVideo error:", e);
      }

      setTimeout(() => {
        try {
          const state = playerRef.current.getPlayerState?.();
          if (state !== window.YT.PlayerState.PLAYING) {
            if (recoveryAttemptsRef.current >= RECREATE_AFTER) {
              console.warn("[RECOVER] recreating player");
              const vid = currentYt?.videoId;
              try { playerRef.current.destroy?.(); } catch {}
              playerRef.current = null;
              recoveryAttemptsRef.current = 0;
              setTimeout(() => { if (vid) createIframeAndPlayer(vid); }, 200);
            } else {
              tryRecoverPlayback();
            }
          } else {
            // success
            recoveryAttemptsRef.current = 0;
            shortPauseCountRef.current = 0;
          }
        } catch (e) {
          console.warn("[RECOVER] final check error:", e);
        }
      }, 450);
    }, delay);
  }, [userStartedPlayback, currentYt]);

  // ---------------- player handlers ----------------
  const handlePlayerReady = useCallback((event) => {
    recoveryAttemptsRef.current = 0;
    try { event.target.mute?.(); } catch {}
    try { const d = event.target.getDuration?.() || 0; setDuration(d); } catch {}
    console.log("[YT] player ready");
  }, []);

  const handlePlayerStateChange = useCallback((event) => {
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
      if (event.data === YT.PlayerState.ENDED && duration) setCurrentTime(duration);
      stopTimeUpdates();

      try {
        const t = playerRef.current.getCurrentTime?.() || 0;
        const sincePlay = Date.now() - (playStartTimestampRef.current || 0);
        if (userStartedPlayback && sincePlay < 4000 && t < 2) {
          shortPauseCountRef.current += 1;
          console.warn(`[SHORT-PAUSE] count=${shortPauseCountRef.current} sincePlay=${sincePlay}ms ct=${t}s`);
          if (shortPauseCountRef.current >= 2) {
            console.warn("[SHORT-PAUSE] threshold reached, recreating player");
            const vid = currentYt?.videoId;
            try { playerRef.current.destroy?.(); } catch {}
            playerRef.current = null;
            shortPauseCountRef.current = 0;
            recoveryAttemptsRef.current = 0;
            setTimeout(() => { if (vid) createIframeAndPlayer(vid); setTimeout(() => { tryRecoverPlayback(); }, 600); }, 200);
            return;
          } else {
            tryRecoverPlayback();
          }
        } else {
          shortPauseCountRef.current = 0;
        }
      } catch (e) {
        console.warn("[SHORT-PAUSE] check failed:", e);
      }
    }
  }, [duration, startTimeUpdates, stopTimeUpdates, tryRecoverPlayback, userStartedPlayback, currentYt]);

  // ---------------- serialize iframe/player creation ----------------
  const createIframeAndPlayer = useCallback((videoId) => {
    if (creatingRef.current) {
      if (playerRef.current && typeof playerRef.current.loadVideoById === "function") {
        try { playerRef.current.loadVideoById(videoId); } catch {}
      }
      console.warn("[CREATE] creation already in progress - skipping");
      return;
    }

    creatingRef.current = true;
    if (instantiateTimerRef.current) {
      clearTimeout(instantiateTimerRef.current);
      instantiateTimerRef.current = null;
    }

    const container = document.getElementById("yt-player-iframe");
    if (!container) {
      creatingRef.current = false;
      console.warn("[CREATE] container missing");
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
    const origin = encodeURIComponent(window.location.origin || "");
    const iframeHost = "https://www.youtube-nocookie.com";
    const src = `${iframeHost}/embed/${videoId}?enablejsapi=1&autoplay=0&playsinline=1&controls=0&origin=${origin}`;

    const instanceId = `yt-player-el-${Date.now()}`;
    iframeIdRef.current = instanceId;
    const wrapper = document.createElement("div");
    wrapper.id = instanceId;
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    container.appendChild(wrapper);

    console.log("[CREATE] wrapper appended; scheduling src attach");

    requestAnimationFrame(() => {
      try {
        playerRef.current = new window.YT.Player(instanceId, {
          videoId,
          height: "160",
          width: "320",
          playerVars: {
            autoplay: 0,
            controls: 0,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: handlePlayerReady,
            onStateChange: handlePlayerStateChange,
            onError: (e) => {
              console.error("[YT] onError", e && e.data);
              tryRecoverPlayback();
            },
          },
        });
        console.log("[CREATE] YT.Player instantiated (autoplay disabled)");
      } catch (err) {
        console.error("[CREATE] YT.Player instantiation failed:", err);
      } finally {
        creatingRef.current = false;
      }
    });

    instantiateTimerRef.current = setTimeout(() => {
      if (!playerRef.current) {
        console.warn("[CREATE] fallback instantiateTimer fired — attempting instantiate");
        try {
          playerRef.current = new window.YT.Player(instanceId, {
            videoId,
            height: "160",
            width: "320",
            playerVars: {
              autoplay: 0,
              controls: 0,
              rel: 0,
              playsinline: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: handlePlayerReady,
              onStateChange: handlePlayerStateChange,
              onError: (e) => {
                console.error("[YT] onError (fallback)", e && e.data);
                tryRecoverPlayback();
              },
            },
          });
          console.log("[CREATE] fallback instantiated YT.Player");
        } catch (err) {
          console.error("[CREATE] fallback instantiation failed:", err);
        } finally {
          creatingRef.current = false;
          instantiateTimerRef.current = null;
        }
      }
    }, 900);
  }, [handlePlayerReady, handlePlayerStateChange, tryRecoverPlayback]);

  // ---------------- when selected video changes ----------------
  useEffect(() => {
    if (!playerApiReady || !currentYt) return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    recoveryAttemptsRef.current = 0;
    shortPauseCountRef.current = 0;
    setUserStartedPlayback(false);

    // create the iframe/player (serialized)
    createIframeAndPlayer(currentYt.videoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerApiReady, currentYt]);

  // ---------------- cleanup ----------------
  useEffect(() => {
    return () => {
      stopTimeUpdates();
      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;
      creatingRef.current = false;
      if (instantiateTimerRef.current) {
        clearTimeout(instantiateTimerRef.current);
        instantiateTimerRef.current = null;
      }
      const container = document.getElementById("yt-player-iframe");
      if (container) container.innerHTML = "";
    };
  }, [stopTimeUpdates]);

  // ---------------- user start playback (gesture) ----------------
  const handleUserStartPlayback = useCallback(() => {
    if (!playerRef.current) {
      console.warn("[USER PLAY] no player ready yet");
      return;
    }
    try {
      playerRef.current.unMute?.();
      playerRef.current.playVideo?.();
      setUserStartedPlayback(true);
      recoveryAttemptsRef.current = 0;
      shortPauseCountRef.current = 0;
    } catch (e) {
      console.warn("[USER PLAY] failed, invoking recovery:", e);
      tryRecoverPlayback();
    }
  }, [tryRecoverPlayback]);

  // ---------------- select song + recent save ----------------
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
    }).catch((err) => console.error("Error saving recent:", err));
  }, []);

  // ---------------- playlist / search handlers (unchanged logic) ----------------
  const handleCreatePlaylist = useCallback(async (name) => {
    try {
      const res = await fetch(`${API}/api/playlists`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setPlaylists((prev) => [...prev, { ...data, id: data.id.toString() }]);
    } catch (err) { console.error(err); }
  }, []);

  const handleRenamePlaylist = useCallback(async (id, newName) => {
    try {
      const res = await fetch(`${API}/api/playlists/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
      if (!res.ok) { alert("Failed to rename playlist"); return; }
      const res2 = await fetch(`${API}/api/playlists`);
      const data2 = await res2.json();
      if (data2.playlists) setPlaylists(data2.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
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
      const res = await fetch(`${API}/api/playlists/${playlistId}`, { method: "DELETE" });
      if (!res.ok) { alert("Failed to delete playlist"); return; }
      const res2 = await fetch(`${API}/api/playlists`);
      const data2 = await res2.json();
      if (data2.playlists) setPlaylists(data2.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, []);

  const handleToggleLike = useCallback(async () => {
    if (!currentYt) return;
    try {
      const res = await fetch(`${API}/api/liked/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentYt) });
      const data = await res.json();
      if (data.error) { console.error("Like toggle error:", data.error); return; }
      const plRes = await fetch(`${API}/api/playlists`);
      const plData = await plRes.json();
      if (plData.playlists) setPlaylists(plData.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
    } catch (err) { console.error(err); }
  }, [currentYt]);

  const likedPlaylist = playlists.find((pl) => pl.isDefault);
  const isCurrentLiked = !!currentYt && !!likedPlaylist && likedPlaylist.songs.some((s) => s.videoId === currentYt.videoId);

  // ---------------- search ----------------
  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setHistory((prev) => [...prev, { results: ytResults, query }]);
    setSearchActive(true);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.error) { alert(data.error); setLoading(false); return; }
      setYtResults(data.results || []);
    } catch (err) {
      console.error("Error searching YouTube:", err);
      alert("Error searching. Check console for details.");
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

  // ---------------- controls ----------------
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
    const newTime = Math.max(0, ct - 10);
    playerRef.current.seekTo?.(newTime, true);
    setCurrentTime(newTime);
  }, [currentTime]);

  const handleSkipForward = useCallback(() => {
    if (!playerRef.current) return;
    const dur = duration || (playerRef.current.getDuration?.() || 0);
    const ct = playerRef.current.getCurrentTime?.() || currentTime;
    const newTime = Math.min(dur, ct + 10);
    playerRef.current.seekTo?.(newTime, true);
    setCurrentTime(newTime);
  }, [currentTime, duration]);

  const handleTrackClick = useCallback((e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
    const newTime = percent * duration;
    playerRef.current.seekTo?.(newTime, true);
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

  // --------------- UI ----------------
  return (
    <div className="app">
      <h1 className="title">🎶 My Music 🎵</h1>

      <form className="search-form" onSubmit={handleSearch}>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, artists..." />
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
              {!loading && ytResults.length === 0 && searchActive && <p className="status-text">No results yet. Try another search.</p>}
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
                <span className="vibe-bar" /><span className="vibe-bar" /><span className="vibe-bar" /><span className="vibe-bar" /><span className="vibe-bar" />
              </div>

              {/* Hidden player wrapper (audio-only). kept tiny/offscreen so iframe exists and audio can play. */}
              <div className="yt-player-wrapper" style={{ height: 1, width: 1, overflow: "hidden", position: "absolute", left: -9999, top: -9999 }}>
                <div id="yt-player-iframe" className="yt-player" style={{ width: "100%", height: "100%" }} />
              </div>

              <div className="track-container">
                <div className="track-time"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
                <div className="track-bar" ref={trackBarRef} onClick={handleTrackClick}><div className="track-bar-inner" style={{ width: `${progressPercent}%` }} /></div>
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
