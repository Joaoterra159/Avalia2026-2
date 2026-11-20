CREATE TABLE IF NOT EXISTS discord_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES discord_users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_sessions_expires ON discord_sessions(expires_at);

CREATE TABLE IF NOT EXISTS discord_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires ON discord_oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_project_records_project_user
  ON project_records(chave_projeto, user_id, id DESC);
