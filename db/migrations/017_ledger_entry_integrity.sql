CREATE OR REPLACE FUNCTION validate_ledger_transaction_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx UUID; n INTEGER; deb NUMERIC(78,0); cre NUMERIC(78,0); bad INTEGER;
BEGIN
  tx:=COALESCE(NEW.transaction_id,OLD.transaction_id);
  SELECT count(*),COALESCE(sum(amount_atomic) FILTER(WHERE direction='debit'),0),COALESCE(sum(amount_atomic) FILTER(WHERE direction='credit'),0)
    INTO n,deb,cre FROM ledger_entries WHERE transaction_id=tx;
  SELECT count(*) INTO bad FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
    WHERE e.transaction_id=tx AND e.asset_code<>t.asset_code;
  IF n<2 OR deb<>cre OR bad>0 THEN RAISE EXCEPTION 'unbalanced_ledger_transaction'; END IF;
  RETURN NULL;
END $$;
DO $m$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ledger_entries_balanced_ct') THEN
    CREATE CONSTRAINT TRIGGER ledger_entries_balanced_ct AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_ledger_transaction_entries();
  END IF;
END
$m$;