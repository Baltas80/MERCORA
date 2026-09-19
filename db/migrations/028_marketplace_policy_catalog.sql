CREATE TABLE IF NOT EXISTS marketplace_policy_versions(
  version INTEGER PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_policy_one_active ON marketplace_policy_versions(active) WHERE active;
INSERT INTO marketplace_policy_versions(version,active,description) VALUES(1,TRUE,'Initial legal second-hand marketplace policy; restricted categories require manual review.') ON CONFLICT(version) DO NOTHING;
CREATE TABLE IF NOT EXISTS marketplace_category_rules(
  category_slug TEXT PRIMARY KEY,
  classification TEXT NOT NULL CHECK(classification IN('allowed','restricted','prohibited')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL,
  policy_version INTEGER NOT NULL REFERENCES marketplace_policy_versions(version)
);
INSERT INTO marketplace_category_rules(category_slug,classification,reason,policy_version) VALUES
('electronics','allowed','ordinary second-hand electronics',1),
('computing','allowed','ordinary second-hand computing equipment',1),
('cameras','allowed','ordinary second-hand cameras',1),
('home','allowed','ordinary household goods',1),
('collectibles','restricted','manual review for sensitive collectibles',1),
('tools','restricted','manual review for potentially regulated tools',1),
('clothing','allowed','ordinary second-hand clothing',1),
('other','restricted','manual review when category is uncertain',1)
ON CONFLICT(category_slug) DO NOTHING;
