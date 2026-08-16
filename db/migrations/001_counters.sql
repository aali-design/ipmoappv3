CREATE TABLE IF NOT EXISTS counters (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  value     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, name)
);
