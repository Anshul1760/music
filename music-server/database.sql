
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(150),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- playlists table
CREATE TABLE IF NOT EXISTS playlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT 1,               -- for now, single user (id=1)
  name VARCHAR(100) NOT NULL,
  is_default TINYINT(1) DEFAULT 0,     -- 1 for "Liked Songs"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- songs in playlists
CREATE TABLE IF NOT EXISTS playlist_songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT NOT NULL,
  videoId VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  channel VARCHAR(255),
  thumbnail VARCHAR(500),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uniq_playlist_song (playlist_id, videoId),
  KEY idx_playlist_id (playlist_id),

  CONSTRAINT fk_playlist
    FOREIGN KEY (playlist_id)
    REFERENCES playlists(id)
    ON DELETE CASCADE
);


-- recently played (we’ll keep last N per user)
CREATE TABLE IF NOT EXISTS recent_played (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT 1,
  videoId VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  channel VARCHAR(255),
  thumbnail VARCHAR(500),
  played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_recent_user_song (user_id, videoId)
);

INSERT INTO playlists (user_id, name, is_default)
VALUES (1, 'Liked Songs', 1);
