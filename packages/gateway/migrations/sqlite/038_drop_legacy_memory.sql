-- Drop legacy durable memory tables (pre Memory v1).
-- Memory v1 uses memory_items + provenance/tags/tombstones (+ derived indexes).

DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS episodic_events;
DROP TABLE IF EXISTS capability_memories;
DROP TABLE IF EXISTS pam_profiles;
DROP TABLE IF EXISTS pvp_profiles;

