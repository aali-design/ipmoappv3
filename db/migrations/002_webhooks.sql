CREATE TABLE IF NOT EXISTS webhooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  url        text NOT NULL,
  event      text NOT NULL,
  secret     text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_school ON webhooks(school_id);
