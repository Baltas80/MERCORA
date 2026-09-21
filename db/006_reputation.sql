-- MERCORA verified reputation and sales metrics.
-- Ratings are valid only after a completed order containing the rated seller.

ALTER TABLE seller_ratings
  DROP CONSTRAINT IF EXISTS seller_ratings_order_id_buyer_account_id_key;

ALTER TABLE seller_ratings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','under_review','hidden')),
  ADD COLUMN IF NOT EXISTS verified_purchase_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by TEXT,
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_ratings_verified_once
  ON seller_ratings(order_id, seller_account_id, buyer_account_id);

CREATE INDEX IF NOT EXISTS idx_seller_ratings_seller_status_created
  ON seller_ratings(seller_account_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION mercora_validate_seller_rating()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_buyer UUID;
  v_order_status TEXT;
BEGIN
  SELECT buyer_account_id, status
    INTO v_order_buyer, v_order_status
    FROM orders
   WHERE id = NEW.order_id;

  IF v_order_buyer IS NULL THEN
    RAISE EXCEPTION 'rating order not found';
  END IF;

  IF NEW.buyer_account_id <> v_order_buyer THEN
    RAISE EXCEPTION 'rating buyer does not match order buyer';
  END IF;

  IF NEW.buyer_account_id = NEW.seller_account_id THEN
    RAISE EXCEPTION 'self-rating is not allowed';
  END IF;

  IF v_order_status <> 'completed' THEN
    RAISE EXCEPTION 'seller rating requires a completed order';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM order_items
     WHERE order_id = NEW.order_id
       AND seller_account_id = NEW.seller_account_id
  ) THEN
    RAISE EXCEPTION 'seller is not part of the verified order';
  END IF;

  NEW.verified_purchase_at := COALESCE(NEW.verified_purchase_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_seller_rating ON seller_ratings;
CREATE TRIGGER trg_validate_seller_rating
BEFORE INSERT OR UPDATE OF order_id, seller_account_id, buyer_account_id
ON seller_ratings
FOR EACH ROW
EXECUTE FUNCTION mercora_validate_seller_rating();

CREATE OR REPLACE FUNCTION mercora_refresh_seller_rating_totals(p_seller UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE seller_profiles sp
     SET rating_count = COALESCE((
           SELECT count(*)::integer
             FROM seller_ratings r
            WHERE r.seller_account_id = p_seller
              AND r.status = 'published'
              AND r.verified_purchase_at IS NOT NULL
         ), 0),
         rating_sum = COALESCE((
           SELECT sum(r.score)::integer
             FROM seller_ratings r
            WHERE r.seller_account_id = p_seller
              AND r.status = 'published'
              AND r.verified_purchase_at IS NOT NULL
         ), 0)
   WHERE sp.account_id = p_seller;
END;
$$;

CREATE OR REPLACE FUNCTION mercora_sync_seller_rating_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM mercora_refresh_seller_rating_totals(OLD.seller_account_id);
    RETURN OLD;
  END IF;

  PERFORM mercora_refresh_seller_rating_totals(NEW.seller_account_id);
  IF TG_OP = 'UPDATE' AND OLD.seller_account_id <> NEW.seller_account_id THEN
    PERFORM mercora_refresh_seller_rating_totals(OLD.seller_account_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seller_rating_totals ON seller_ratings;
CREATE TRIGGER trg_sync_seller_rating_totals
AFTER INSERT OR UPDATE OR DELETE
ON seller_ratings
FOR EACH ROW
EXECUTE FUNCTION mercora_sync_seller_rating_totals();

-- Legacy rows that already correspond to a completed order remain visible as verified.
UPDATE seller_ratings r
   SET verified_purchase_at = COALESCE(r.verified_purchase_at, r.created_at)
 WHERE r.verified_purchase_at IS NULL
   AND EXISTS (
     SELECT 1
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = r.order_id
        AND o.status = 'completed'
        AND o.buyer_account_id = r.buyer_account_id
        AND oi.seller_account_id = r.seller_account_id
   );

-- Legacy rows that cannot be proven against a completed order are hidden.
UPDATE seller_ratings
   SET status = 'under_review',
       moderation_reason = COALESCE(moderation_reason, 'Legacy rating without a provable completed order')
 WHERE verified_purchase_at IS NULL;

-- Rebuild the denormalized seller profile totals from verified published reviews.
UPDATE seller_profiles sp
   SET rating_count = COALESCE((
         SELECT count(*)::integer
           FROM seller_ratings r
          WHERE r.seller_account_id = sp.account_id
            AND r.status = 'published'
            AND r.verified_purchase_at IS NOT NULL
       ), 0),
       rating_sum = COALESCE((
         SELECT sum(r.score)::integer
           FROM seller_ratings r
          WHERE r.seller_account_id = sp.account_id
            AND r.status = 'published'
            AND r.verified_purchase_at IS NOT NULL
       ), 0);

CREATE OR REPLACE VIEW seller_reputation AS
WITH sales AS (
  SELECT oi.seller_account_id,
         count(DISTINCT oi.order_id)::bigint AS verified_sales_count,
         COALESCE(sum(oi.quantity) FILTER (WHERE o.status='completed'), 0)::bigint AS verified_units_sold
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
   WHERE o.status = 'completed'
   GROUP BY oi.seller_account_id
),
ratings AS (
  SELECT r.seller_account_id,
         count(*) FILTER (
           WHERE r.status='published' AND r.verified_purchase_at IS NOT NULL
         )::bigint AS verified_rating_count,
         COALESCE(sum(r.score) FILTER (
           WHERE r.status='published' AND r.verified_purchase_at IS NOT NULL
         ), 0)::bigint AS verified_rating_sum
    FROM seller_ratings r
   GROUP BY r.seller_account_id
)
SELECT sp.account_id,
       sp.display_name,
       COALESCE(s.verified_sales_count, 0)::bigint AS verified_sales_count,
       COALESCE(s.verified_units_sold, 0)::bigint AS verified_units_sold,
       COALESCE(r.verified_rating_count, 0)::bigint AS verified_rating_count,
       COALESCE(r.verified_rating_sum, 0)::bigint AS verified_rating_sum,
       CASE
         WHEN COALESCE(r.verified_rating_count,0) > 0
         THEN round(r.verified_rating_sum::numeric / r.verified_rating_count::numeric, 2)
         ELSE NULL
       END AS rating_average
  FROM seller_profiles sp
  LEFT JOIN sales s ON s.seller_account_id = sp.account_id
  LEFT JOIN ratings r ON r.seller_account_id = sp.account_id;

CREATE INDEX IF NOT EXISTS idx_seller_ratings_moderation
  ON seller_ratings(status, created_at DESC);
