import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

/**
 * --- GLOBAL CONFIGURATION ---
 * Dynamically resolves the API endpoint for development and production.
 */
const API =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
    ? "http://localhost:5001"
    : `http://${window.location.hostname}:5001`);

export default function App() {
  // --- Core Application State ---
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [playerApiReady, setPlayerApiReady] = useState(false);

  // --- Playback State ---
  const [currentYt, setCurrentYt] = useState(() => {
    const saved = localStorage.getItem("current_song");
    return saved ? JSON.parse(saved) : null;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // --- Library & Playlist State ---
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  // --- Ref Store (Prevents closure staleness in background tasks) ---
  const playerRef = useRef(null);
  const creatingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);
  const recoveryAttemptsRef = useRef(0);

  // ---------------------------------------------------------
  // 1. UTILITIES & LOGGING
  // ---------------------------------------------------------

  const logger = useCallback((msg, type = "info") => {
    const time = new Date().toLocaleTimeString();
    console[type](`[${time}] ${msg}`);
  }, []);

  const formatTime = (sec) => {
    if (!sec || isNaN(sec)) return "0:00";
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ---------------------------------------------------------
  // 2. WAKE LOCK & BACKGROUND PERSISTENCE
  // ---------------------------------------------------------

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      if (document.visibilityState === "visible") {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        logger("WakeLock acquired successfully.");
      }
    } catch (err) {
      logger(`WakeLock Request Failed: ${err.message}`, "warn");
    }
  }, [logger]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (playerRef.current && isPlayingRef.current) {
          playerRef.current.playVideo?.();
          setTimeout(() => {
            if (isPlayingRef.current) playerRef.current?.playVideo?.();
          }, 150);
        }
      } else {
        if (isPlayingRef.current) {
          requestWakeLock();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock]);

  // ---------------------------------------------------------
  // 3. PLAYBACK ENGINE CONTROLS
  // ---------------------------------------------------------

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current || !window.YT) return;
    const state = playerRef.current.getPlayerState?.();
    if (state === window.YT.PlayerState.PLAYING) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.unMute();
      playerRef.current.playVideo();
      requestWakeLock();
    }
  }, [requestWakeLock]);

  const handleSkipBackward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime() || 0;
    playerRef.current.seekTo(Math.max(0, ct - 10), true);
  }, []);

  const handleSkipForward = useCallback(() => {
    if (!playerRef.current) return;
    const ct = playerRef.current.getCurrentTime() || 0;
    const dur = playerRef.current.getDuration() || 0;
    playerRef.current.seekTo(Math.min(dur, ct + 10), true);
  }, []);

  const handleTrackClick = useCallback((e) => {
    if (!playerRef.current || !duration || !trackBarRef.current) return;
    const rect = trackBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    playerRef.current.seekTo(percent * duration, true);
  }, [duration]);

  // ---------------------------------------------------------
  // 4. MEDIA SESSION (Lock Screen Controls)
  // ---------------------------------------------------------

  const setupMediaSession = useCallback((song) => {
    if ("mediaSession" in navigator && song) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: song.title,
        artist: song.channel,
        album: "Cloud Beats",
        artwork: [
          { src: song.thumbnail, sizes: "96x96", type: "image/png" },
          { src: song.thumbnail, sizes: "256x256", type: "image/png" },
          { src: song.thumbnail, sizes: "512x512", type: "image/png" },
        ],
      });

      navigator.mediaSession.setActionHandler("play", handleTogglePlay);
      navigator.mediaSession.setActionHandler("pause", handleTogglePlay);
      navigator.mediaSession.setActionHandler("seekbackward", handleSkipBackward);
      navigator.mediaSession.setActionHandler("seekforward", handleSkipForward);
    }
  }, [handleTogglePlay, handleSkipBackward, handleSkipForward]);

  // ---------------------------------------------------------
  // 5. DATA PERSISTENCE & FETCHING
  // ---------------------------------------------------------

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/playlists`);
      if (!res.ok) throw new Error("Backend Offline");
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
      }
    } catch (err) {
      logger(`Playlist Sync Error: ${err.message}`, "error");
    }
  }, [logger]);

  const handleSelectSong = useCallback((song) => {
    if (!song) return;
    setCurrentYt(song);
    localStorage.setItem("current_song", JSON.stringify(song));
    
    fetch(`${API}/api/recent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(song),
    }).catch(() => {});

    setRecentPlayed(prev => {
      const filtered = prev.filter(s => s.videoId !== song.videoId);
      return [song, ...filtered].slice(0, 15);
    });
  }, []);

  useEffect(() => {
    const initApp = async () => {
      try {
        const recentRes = await fetch(`${API}/api/recent`);
        const recentData = await recentRes.json();
        setRecentPlayed(Array.isArray(recentData) ? recentData : []);
        await fetchPlaylists();
      } catch (err) {
        logger("Initial Handshake Failed", "error");
      }
    };
    initApp();
  }, [fetchPlaylists, logger]);

  // ---------------------------------------------------------
  // 6. YOUTUBE PLAYER INTEGRATION
  // ---------------------------------------------------------

  const stopTimeUpdates = useCallback(() => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
  }, []);

  const startTimeUpdates = useCallback(() => {
    stopTimeUpdates(); // Properly clearing before starting new interval
    timeIntervalRef.current = setInterval(() => {
      if (playerRef.current?.getPlayerState) {
        const state = playerRef.current.getPlayerState();
        if (state === 1) { // Playing
          setIsBuffering(false);
          const ct = playerRef.current.getCurrentTime() || 0;
          const dur = playerRef.current.getDuration() || 0;
          setCurrentTime(ct);
          setDuration(dur);

          if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
              duration: dur,
              playbackRate: 1,
              position: ct,
            });
          }
        } else if (state === 3) { // Buffering
          setIsBuffering(true);
        }
      }
    }, 1000);
  }, [stopTimeUpdates]); // Dependency included to fix ESLint warning

  const handlePlayerReady = useCallback((event) => {
    recoveryAttemptsRef.current = 0;
    event.target.unMute?.();
    setDuration(event.target.getDuration() || 0);
  }, []);

  const createIframeAndPlayer = useCallback((videoId) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setIsBuffering(true);

    const container = document.getElementById("yt-player-iframe");
    if (!container) { creatingRef.current = false; return; }

    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById(videoId);
      creatingRef.current = false;
      return;
    }

    container.innerHTML = "";
    const instanceId = `yt-player-el-${Date.now()}`;
    const wrapper = document.createElement("div");
    wrapper.id = instanceId;
    container.appendChild(wrapper);

    playerRef.current = new window.YT.Player(instanceId, {
      videoId,
      height: "240", width: "100%",
      playerVars: { 
        autoplay: 1, 
        controls: 0, 
        playsinline: 1, 
        enablejsapi: 1,
        rel: 0,
        modestbranding: 1 
      },
      events: {
        onReady: handlePlayerReady,
        onStateChange: (e) => {
          const state = e.data;
          const YT_STATE = window.YT.PlayerState;
          if (state === YT_STATE.PLAYING) {
            setIsPlaying(true); setIsBuffering(false); startTimeUpdates();
            requestWakeLock();
          } else if (state === YT_STATE.PAUSED || state === YT_STATE.ENDED) {
            setIsPlaying(false); stopTimeUpdates();
          }
        },
        onError: () => {
          if (recoveryAttemptsRef.current < 3) {
            recoveryAttemptsRef.current++;
            playerRef.current?.playVideo();
          }
        }
      },
    });
    creatingRef.current = false;
  }, [handlePlayerReady, startTimeUpdates, stopTimeUpdates, requestWakeLock]);

  useEffect(() => {
    if (playerApiReady && currentYt) {
      createIframeAndPlayer(currentYt.videoId);
      setupMediaSession(currentYt);
    }
  }, [playerApiReady, currentYt, createIframeAndPlayer, setupMediaSession]);

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

  // ---------------------------------------------------------
  // 7. PLAYLIST & LIKE ACTIONS
  // ---------------------------------------------------------

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchActive(true); setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results) setYtResults(data.results);
    } catch (err) {
      logger("Search Operation Failed", "error");
    } finally { setLoading(false); }
  };

  const handleToggleLike = async () => {
    if (!currentYt) return;
    try {
      await fetch(`${API}/api/liked/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentYt)
      });
      fetchPlaylists();
    } catch (err) {}
  };

  // ---------------------------------------------------------
  // 8. FINAL RENDER
  // ---------------------------------------------------------

  const isCurrentLiked = playlists.find(p => p.isDefault)?.songs.some(s => s.videoId === currentYt?.videoId);
  const showHome = !loading && ytResults.length === 0 && !searchActive;

  return (
    <div className="app">
      <h1 className="title">🎶 Cloud Beats 🎵</h1>
      
      <form className="search-form" onSubmit={handleSearch}>
        <input 
          className="search-input" 
          value={query} 
          onChange={(e) => setQuery(e.target.value)} 
          placeholder="Search songs or artists..." 
        />
        <button className="search-button" type="submit">Search</button>
      </form>

      {loading && <p className="status-text pulse">Loading tracks from the cloud...</p>}

      <div className={`layout ${!currentYt ? "layout-full" : ""}`}>
        <div className="card library-card">
          <div className="results-header">
            {searchActive && (
              <button 
                type="button" 
                className="back-button" 
                onClick={() => {setSearchActive(false); setYtResults([]);}}
              >
                🔙 Back
              </button>
            )}
            <h2 className="results-title">{searchActive ? "Search Results" : "Your Music"}</h2>
          </div>

          {showHome ? (
            <div className="home-sections">
              <RecentlyPlayed 
                recentPlayed={recentPlayed} 
                onSelectSong={handleSelectSong} 
                isPlaying={!!currentYt} 
              />
              <Playlist 
                playlists={playlists} 
                onSelectSong={handleSelectSong} 
                currentSong={currentYt}
                onCreatePlaylist={async (n) => { 
                  await fetch(`${API}/api/playlists`, { 
                    method:"POST", 
                    headers:{"Content-Type":"application/json"}, 
                    body:JSON.stringify({name:n}) 
                  }); 
                  fetchPlaylists(); 
                }}
                onRenamePlaylist={async (id, n) => { 
                  await fetch(`${API}/api/playlists/${id}`, { 
                    method:"PUT", 
                    headers:{"Content-Type":"application/json"}, 
                    body:JSON.stringify({name:n}) 
                  }); 
                  fetchPlaylists(); 
                }}
                onAddSongToPlaylist={async (id, s) => { 
                  await fetch(`${API}/api/playlists/${id}/songs`, { 
                    method:"POST", 
                    headers:{"Content-Type":"application/json"}, 
                    body:JSON.stringify(s) 
                  }); 
                  fetchPlaylists(); 
                }}
                onRemoveSongFromPlaylist={async (id, vid) => { 
                  await fetch(`${API}/api/playlists/${id}/songs/${vid}`, { method:"DELETE" }); 
                  fetchPlaylists(); 
                }}
                onDeletePlaylist={async (id) => { 
                  await fetch(`${API}/api/playlists/${id}`, { method:"DELETE" }); 
                  fetchPlaylists(); 
                }}
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
          <div className="card now-playing-card">
            <h2>Now Playing</h2>
            <div className="now-title">{currentYt.title}</div>
            <div className="now-meta">{currentYt.channel}</div>

            <div className="vibe-container">
              {isBuffering && <div className="audio-loader">Connecting stream...</div>}
              <div className={`vibe vibe-large ${isPlaying && !isBuffering ? "playing" : ""}`}>
                {[...Array(6)].map((_, i) => <span key={i} className="vibe-bar" />)}
              </div>
            </div>

            <div className="yt-player-wrapper" style={{ height: 1, width: 1, overflow: "hidden", position: "absolute", left: -9999 }}>
              <div id="yt-player-iframe" className="yt-player" />
            </div>

            <div className="track-container">
              <div className="track-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="track-bar" ref={trackBarRef} onClick={handleTrackClick}>
                <div 
                  className="track-bar-inner" 
                  style={{ width: `${(currentTime / duration) * 100 || 0}%` }} 
                />
              </div>
            </div>

            <div className="controls">
              <button className="control-btn" onClick={handleSkipBackward}>↩️</button>
              <button className="control-btn main-play" onClick={handleTogglePlay}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button className="control-btn" onClick={handleSkipForward}>↪️</button>
              <button className="like-btn" onClick={handleToggleLike}>
                {isCurrentLiked ? "❤️" : "🤍"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}