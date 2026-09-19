-- Establish explicit financial operating-mode defaults.
-- Missing state must never enable financial operations.
INSERT INTO system_state(key,value)
VALUES
  ('custody_mode','normal'),
  ('marketplace_mode','normal')
ON CONFLICT(key) DO NOTHING;
