-- Editable legal/publication content. Values are plain text and versioned by the admin content service.
INSERT INTO site_settings(key,value,updated_by) VALUES
  ('terms_of_use','Condiciones de uso de MERCORA. Texto pendiente de revisión jurídica antes de producción.','migration'),
  ('privacy_notice','Política de privacidad de MERCORA. Texto pendiente de revisión jurídica antes de producción.','migration'),
  ('publication_rules','Normas de publicación de anuncios de MERCORA.','migration')
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_content_versions(site_key,value,published,actor)
SELECT s.key,s.value,true,'migration'
FROM site_settings s
WHERE s.key IN ('terms_of_use','privacy_notice','publication_rules')
  AND NOT EXISTS (
    SELECT 1 FROM site_content_versions v WHERE v.site_key=s.key
  );
