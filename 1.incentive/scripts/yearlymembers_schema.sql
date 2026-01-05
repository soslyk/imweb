-- 1) Run this in a default DB (e.g., postgres) to create the database.
-- CREATE DATABASE yearlymembers;

-- 2) Connect to the yearlymembers DB, then run the statements below.
CREATE SCHEMA IF NOT EXISTS yearlymembers;

CREATE TABLE IF NOT EXISTS yearlymembers.yearly_member_counts (
  date date NOT NULL,
  branch text NOT NULL,
  count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, branch)
);
