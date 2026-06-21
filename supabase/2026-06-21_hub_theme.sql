-- Add hub_theme preference to user_profiles.
-- Default 'midnight' = the current look, so existing users see no change.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS hub_theme text NOT NULL DEFAULT 'midnight'
  CHECK (hub_theme IN (
    'midnight','carbon','evergreen','slate','ember','mocha',
    'daylight','linen','sage','arctic','blossom','graphite'
  ));
