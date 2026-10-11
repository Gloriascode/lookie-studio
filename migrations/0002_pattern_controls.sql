-- What the creator asked for when making a pattern (shown back in the studio).
ALTER TABLE patterns ADD COLUMN motif TEXT;
ALTER TABLE patterns ADD COLUMN colors_json TEXT;
ALTER TABLE patterns ADD COLUMN style_id TEXT;
