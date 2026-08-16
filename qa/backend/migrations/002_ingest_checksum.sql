-- Add content_hash to ingestion_batches for idempotent re-post detection.
ALTER TABLE ingestion_batches ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_hash
  ON ingestion_batches (project_id, build_id, format, content_hash);
