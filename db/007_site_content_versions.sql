-- Versioned site content for the Admin Console.
-- Values are plain text only; the public application must render them as text, never raw HTML.

CREATE TABLE IF NOT EXISTS site_content_versions (
  id BIGSERIAL PRIMARY KEY,
  site_key TEXT NOT NULL,
  value TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT true,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_content_versions_key_created
  ON site_content_versions(site_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_content_versions_published
  ON site_content_versions(site_key, published, created_at DESC);

INSERT INTO site_content_versions(site_key, value, published, actor)
SELECT key, value, true, 'migration'
FROM site_settings
WHERE key IN (
  'site_name','announcement','maintenance_message','footer_notice','hero_title','hero_copy','buy_cta','sell_cta'
)
  AND value <> ''
  AND NOT EXISTS (
    SELECT 1 FROM site_content_versions v WHERE v.site_key = site_settings.key
  );

-- Keep the publication invariant at the database boundary even under concurrent admin edits.
WITH latest AS (
  SELECT site_key, max(id) AS keep_id
  FROM site_content_versions
  WHERE published=true
  GROUP BY site_key
)
UPDATE site_content_versions v
SET published=false
WHERE v.published=true
  AND EXISTS (
    SELECT 1 FROM latest l
    WHERE l.site_key=v.site_key
      AND l.keep_id<>v.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_content_versions_one_published
  ON site_content_versions(site_key)
  WHERE published=true;
