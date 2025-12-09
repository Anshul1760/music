// src/RecentlyPlayed.jsx
import React, { useState } from "react";
import "./RecentlyPlayed.css";

function RecentlyPlayed({ recentPlayed, onSelectSong }) {
  const [showAll, setShowAll] = useState(false);

  const hasMany = recentPlayed.length >= 5;
  const previewList = hasMany ? recentPlayed.slice(0, 5) : recentPlayed;

  const handleSelect = (song) => {
    onSelectSong(song);
    setShowAll(false); // if we are in full screen, close it on song click
  };

  return (
    <>
      {/* Normal card section */}
      <div className="recent-section">
        <div className="recent-header">
          <h3 className="recent-title">Recently Played</h3>
          {hasMany && (
            <button
              type="button"
              className="recent-show-more"
              onClick={() => setShowAll(true)}
            >
              Show more
            </button>
          )}
        </div>

        {recentPlayed.length === 0 ? (
          <p className="recent-empty">No songs played yet.</p>
        ) : (
          <div className="recent-list">
            {previewList.map((song) => (
              <div
                key={song.videoId}
                className="recent-item"
                onClick={() => handleSelect(song)}
              >
                {song.thumbnail && (
                  <img
                    src={song.thumbnail}
                    alt={song.title}
                    className="recent-thumb"
                  />
                )}
                <div className="recent-info">
                  <div className="recent-song-title">{song.title}</div>
                  <div className="recent-song-meta">{song.channel}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen overlay */}
      {showAll && (
        <div className="recent-overlay">
          <div className="recent-overlay-content">
            <div className="recent-overlay-header">
              <button
                type="button"
                className="recent-overlay-back"
                onClick={() => setShowAll(false)}
              >
                ← Back
              </button>
              <h3 className="recent-overlay-title">Recently Played</h3>
            </div>

            <div className="recent-overlay-list">
              {recentPlayed.length === 0 ? (
                <p className="recent-empty">No songs played yet.</p>
              ) : (
                recentPlayed.map((song) => (
                  <div
                    key={song.videoId}
                    className="recent-item recent-item-large"
                    onClick={() => handleSelect(song)}
                  >
                    {song.thumbnail && (
                      <img
                        src={song.thumbnail}
                        alt={song.title}
                        className="recent-thumb-large"
                      />
                    )}
                    <div className="recent-info">
                      <div className="recent-song-title">{song.title}</div>
                      <div className="recent-song-meta">{song.channel}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default RecentlyPlayed;
