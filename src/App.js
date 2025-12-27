import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import RecentlyPlayed from "./RecentlyPlayed";
import Playlist from "./Playlist";

/**
 * --- CONFIGURATION ---
 * Dynamically resolves the backend API endpoint.
 */
const API =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
    ? "http://localhost:5001"
    : `http://${window.location.hostname}:5001`);

export default function App() {
  // --- UI & Application State ---
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

  // --- Lists & Library State ---
  const [recentPlayed, setRecentPlayed] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  // --- Logic & Background Refs ---
  const playerRef = useRef(null);
  const creatingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const timeIntervalRef = useRef(null);
  const trackBarRef = useRef(null);
  const recoveryAttemptsRef = useRef(0);
  
  /**
   * SILENT AUDIO BRIDGE
   * This is the "Secret Sauce" for Android.
   * By playing a silent audio loop, the browser keeps the tab active 
   * even when the video is hidden.
   */
  const silentAudioRef = useRef(null);

  // Sync ref with state for event listeners
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // ---------------------------------------------------------
  // 1. CORE UTILITIES
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

  // ---------------------------------------------------------
  // 2. BACKGROUND PERSISTENCE LOGIC
  // ---------------------------------------------------------

  const startSilentAudio = useCallback(() => {
    if (!silentAudioRef.current) {
      // 1-second silent WAV base64
      const silentSrc = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A/wD/";
      silentAudioRef.current = new Audio(silentSrc);
      silentAudioRef.current.loop = true;
    }
    silentAudioRef.current.play().catch(() => {
      logger("Silent audio failed - requires user gesture.", "warn");
    });
  }, [logger]);

  const stopSilentAudio = useCallback(() => {
    if (silentAudioRef.current) {
      silentAudioRef.current.pause();
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      if (document.visibilityState === "visible") {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        logger("WakeLock Acquired.");
      }
    } catch (err) {
      logger(`WakeLock Error: ${err.message}`, "warn");
    }
  }, [logger]);

  const stopTimeUpdates = useCallback(() => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------
  // 3. PLAYBACK CONTROLS
  // ---------------------------------------------------------

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current || !window.YT) return;
    const state = playerRef.current.getPlayerState?.();
    if (state === window.YT.PlayerState.PLAYING) {
      playerRef.current.pauseVideo();
      stopSilentAudio();
    } else {
      playerRef.current.unMute();
      playerRef.current.playVideo();
      startSilentAudio();
      requestWakeLock();
    }
  }, [requestWakeLock, startSilentAudio, stopSilentAudio]);

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
  // 4. MEDIA SESSION (Android Lock Screen)
  // ---------------------------------------------------------

  const setupMediaSession = useCallback((song) => {
    if ("mediaSession" in navigator && song) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: song.title,
        artist: song.channel,
        album: "My Music Stream",
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
      
      logger("Media Session configured.");
    }
  }, [handleTogglePlay, handleSkipBackward, handleSkipForward, logger]);

  // ---------------------------------------------------------
  // 5. DATA SYNC & API CALLS
  // ---------------------------------------------------------

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/playlists`);
      if (!res.ok) throw new Error("Backend connection failed");
      const data = await res.json();
      if (data.playlists) {
        setPlaylists(data.playlists.map((pl) => ({ ...pl, id: pl.id.toString() })));
      }
    } catch (err) {
      logger(`Playlist Sync: ${err.message}`, "error");
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

  useEffect(() => {
    const initData = async () => {
      try {
        const recentRes = await fetch(`${API}/api/recent`);
        const recentData = await recentRes.json();
        setRecentPlayed(Array.isArray(recentData) ? recentData : []);
        await fetchPlaylists();
      } catch (err) {}
    };
    initData();
  }, [fetchPlaylists]);

  // ---------------------------------------------------------
  // 6. YOUTUBE ENGINE & VISIBILITY
  // ---------------------------------------------------------

  const startTimeUpdates = useCallback(() => {
    stopTimeUpdates();
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
        } else if (state === 3) {
          setIsBuffering(true);
        }
      }
    }, 1000);
  }, [stopTimeUpdates]);

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

    container.innerHTML = '<div id="yt-instance"></div>';
    playerRef.current = new window.YT.Player("yt-instance", {
      videoId,
      height: "200", width: "100%",
      playerVars: { 
        autoplay: 1, 
        controls: 0, 
        playsinline: 1, 
        enablejsapi: 1,
        rel: 0 
      },
      events: {
        onReady: handlePlayerReady,
        onStateChange: (e) => {
          const state = e.data;
          const YT_S = window.YT.PlayerState;
          if (state === YT_S.PLAYING) {
            setIsPlaying(true); setIsBuffering(false); startTimeUpdates();
            requestWakeLock();
            startSilentAudio();
          } else if (state === YT_S.PAUSED || state === YT_S.ENDED) {
            setIsPlaying(false); stopTimeUpdates();
            stopSilentAudio();
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
  }, [handlePlayerReady, startTimeUpdates, stopTimeUpdates, requestWakeLock, startSilentAudio, stopSilentAudio]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (playerRef.current && isPlayingRef.current) {
          // Double-tap resume for Android Chrome
          playerRef.current.playVideo?.();
          setTimeout(() => {
            if (isPlayingRef.current) playerRef.current?.playVideo?.();
          }, 200);
        }
      } else if (isPlayingRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock]);

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
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => setPlayerApiReady(true);
  }, []);

  // ---------------------------------------------------------
  // 7. UI HANDLERS
  // ---------------------------------------------------------

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchActive(true); setLoading(true);
    try {
      const res = await fetch(`${API}/api/youtube/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results) setYtResults(data.results);
    } catch (err) {} finally { setLoading(false); }
  };

  const isCurrentLiked = playlists.find(p => p.isDefault)?.songs.some(s => s.videoId === currentYt?.videoId);
  const showHome = !loading && ytResults.length === 0 && !searchActive;

  return (
    <div className="app">
      <h1 className="title">🎶 My Premium Music 🎵</h1>
      
      <form className="search-form" onSubmit={handleSearch}>
        <input 
          className="search-input" 
          value={query} 
          onChange={(e) => setQuery(e.target.value)} 
          placeholder="Search songs..." 
        />
        <button className="search-button" type="submit">Search</button>
      </form>

      {loading && <p className="status-text pulse">Loading tracks...</p>}

      <div className={`layout ${!currentYt ? "layout-full" : ""}`}>
        <div className="card scroll-pane">
          <div className="results-header">
            {searchActive && (
              <button className="back-button" onClick={() => {setSearchActive(false); setYtResults([]);}}>🔙</button>
            )}
            <h2 className="results-title">{searchActive ? "Search Results" : "My Library"}</h2>
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
                    method: "POST", 
                    headers: { "Content-Type": "application/json" }, 
                    body: JSON.stringify({ name: n }) 
                  }); 
                  fetchPlaylists(); 
                }}
                onRenamePlaylist={async (id, n) => { 
                  await fetch(`${API}/api/playlists/${id}`, { 
                    method: "PUT", 
                    headers: { "Content-Type": "application/json" }, 
                    body: JSON.stringify({ name: n }) 
                  }); 
                  fetchPlaylists(); 
                }}
                onAddSongToPlaylist={async (id, s) => { 
                  await fetch(`${API}/api/playlists/${id}/songs`, { 
                    method: "POST", 
                    headers: { "Content-Type": "application/json" }, 
                    body: JSON.stringify(s) 
                  }); 
                  fetchPlaylists(); 
                }}
                onRemoveSongFromPlaylist={async (id, vid) => { 
                  await fetch(`${API}/api/playlists/${id}/songs/${vid}`, { method: "DELETE" }); 
                  fetchPlaylists(); 
                }}
                onDeletePlaylist={async (id) => { 
                  await fetch(`${API}/api/playlists/${id}`, { method: "DELETE" }); 
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
          <div className="card player-pane">
            <h2 className="now-playing-label">Now Playing</h2>
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