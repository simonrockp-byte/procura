-- =============================================================================
-- Procura — PostgreSQL Schema
-- Multi-tenant, row-level security, append-only audit log (SHA-256 hash chain)
-- =============================================================================

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE officer_role AS ENUM ('Officer', 'Manager', 'Executive', 'Auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE requisition_status AS ENUM (
    'Draft', 'Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE escalation_tier AS ENUM ('Officer', 'Manager', 'Executive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- ORGANISATIONS  (multi-tenant root)
-- =============================================================================

CREATE TABLE IF NOT EXISTS organisations (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      TEXT NOT NULL,
  slug                      TEXT UNIQUE NOT NULL,
  default_currency          CHAR(3) NOT NULL DEFAULT 'ZMW',
  sla_hours                 INTEGER NOT NULL DEFAULT 72 CHECK (sla_hours > 0),
  -- WhatsApp Cloud API credentials (encrypted at application layer)
  wa_phone_number_id        TEXT,
  wa_access_token_enc       TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- OFFICERS  (users, multi-role)
-- =============================================================================

CREATE TABLE IF NOT EXISTS officers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  phone_number      TEXT,                  -- E.164 e.g. +260971234567, for WhatsApp
  full_name         TEXT NOT NULL,
  password_hash     TEXT,
  role              officer_role NOT NULL DEFAULT 'Officer',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by        UUID REFERENCES officers(id),
  invite_token      TEXT,
  invite_expires_at TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, email),
  UNIQUE (org_id, phone_number)
);

-- =============================================================================
-- SUPPLIERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  registration_number TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  compliance_score    SMALLINT NOT NULL DEFAULT 100
                        CHECK (compliance_score BETWEEN 0 AND 100),
  document_expiry     DATE,
  is_blacklisted      BOOLEAN NOT NULL DEFAULT FALSE,
  blacklist_reason    TEXT,
  blacklisted_by      UUID REFERENCES officers(id),
  blacklisted_at      TIMESTAMPTZ,
  created_by          UUID NOT NULL REFERENCES officers(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ORG REF COUNTERS  (per-org sequential ref numbers, e.g. REQ-0001)
-- =============================================================================

CREATE TABLE IF NOT EXISTS org_ref_counters (
  org_id      UUID    NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  prefix      TEXT    NOT NULL DEFAULT 'REQ',
  last_value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, prefix)
);

CREATE OR REPLACE FUNCTION next_ref_number(p_org_id UUID, p_prefix TEXT DEFAULT 'REQ')
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO org_ref_counters (org_id, prefix, last_value)
  VALUES (p_org_id, p_prefix, 1)
  ON CONFLICT (org_id, prefix) DO UPDATE
    SET last_value = org_ref_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;

-- =============================================================================
-- REQUISITIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS requisitions (
  id              UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID               NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  ref_number      TEXT               NOT NULL,   -- set by trigger on INSERT
  title           TEXT               NOT NULL,
  description     TEXT,
  amount          NUMERIC(18,2)      NOT NULL CHECK (amount > 0),
  currency        CHAR(3)            NOT NULL DEFAULT 'ZMW',
  status          requisition_status NOT NULL DEFAULT 'Draft',
  supplier_id     UUID               REFERENCES suppliers(id),
  created_by      UUID               NOT NULL REFERENCES officers(id),
  approved_by     UUID               REFERENCES officers(id),
  approved_at     TIMESTAMPTZ,
  ordered_at      TIMESTAMPTZ,
  sla_deadline    TIMESTAMPTZ,       -- computed when status → Ordered
  created_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, ref_number)
);

-- Auto-assign ref_number on INSERT
CREATE OR REPLACE FUNCTION assign_req_ref_number()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ref_number IS NULL OR NEW.ref_number = '' THEN
    NEW.ref_number := next_ref_number(NEW.org_id, 'REQ');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_req_ref ON requisitions;
CREATE TRIGGER trg_assign_req_ref
  BEFORE INSERT ON requisitions
  FOR EACH ROW EXECUTE FUNCTION assign_req_ref_number();

-- Set SLA deadline when status transitions to Ordered
CREATE OR REPLACE FUNCTION set_requisition_sla()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_sla_hours INTEGER;
BEGIN
  IF NEW.status = 'Ordered' AND (OLD.status IS DISTINCT FROM 'Ordered') THEN
    SELECT sla_hours INTO v_sla_hours FROM organisations WHERE id = NEW.org_id;
    NEW.sla_deadline := NOW() + (v_sla_hours || ' hours')::INTERVAL;
    NEW.ordered_at   := NOW();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_requisition_sla ON requisitions;
CREATE TRIGGER trg_requisition_sla
  BEFORE UPDATE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION set_requisition_sla();

-- =============================================================================
-- DELIVERIES  (immutable once created)
-- =============================================================================

CREATE TABLE IF NOT EXISTS deliveries (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requisition_id   UUID          NOT NULL REFERENCES requisitions(id),
  photo_url        TEXT,
  gps_lat          DECIMAL(9,6),
  gps_lng          DECIMAL(9,6),
  confirmed_by     UUID          NOT NULL REFERENCES officers(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  -- No updated_at — deliveries are immutable
);

-- Prevent any update to deliveries
CREATE OR REPLACE FUNCTION prevent_delivery_update()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery records are immutable — they cannot be updated';
END;
$$;

DROP TRIGGER IF EXISTS trg_no_delivery_update ON deliveries;
CREATE TRIGGER trg_no_delivery_update
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION prevent_delivery_update();

-- =============================================================================
-- PAYMENTS  (must link to a confirmed delivery on the same requisition)
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requisition_id     UUID          NOT NULL REFERENCES requisitions(id),
  delivery_id        UUID          NOT NULL REFERENCES deliveries(id),  -- ENFORCED: FK NOT NULL
  amount             NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency           CHAR(3)       NOT NULL DEFAULT 'ZMW',
  payment_reference  TEXT,
  notes              TEXT,
  paid_by            UUID          NOT NULL REFERENCES officers(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enforce: delivery must belong to the same requisition
CREATE OR REPLACE FUNCTION check_payment_delivery_match()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_delivery_req_id UUID;
BEGIN
  SELECT requisition_id INTO v_delivery_req_id
  FROM deliveries WHERE id = NEW.delivery_id;

  IF v_delivery_req_id IS NULL THEN
    RAISE EXCEPTION 'delivery % not found', NEW.delivery_id;
  END IF;

  IF v_delivery_req_id <> NEW.requisition_id THEN
    RAISE EXCEPTION
      'delivery % belongs to requisition % — not the requisition % on this payment',
      NEW.delivery_id, v_delivery_req_id, NEW.requisition_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_payment_delivery ON payments;
CREATE TRIGGER trg_check_payment_delivery
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION check_payment_delivery_match();

-- =============================================================================
-- AUDIT LOG  (append-only, SHA-256 hash chain — enforced by triggers)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL     PRIMARY KEY,
  org_id      UUID          NOT NULL,   -- intentionally not FK so system entries survive org changes
  actor_id    UUID,                     -- NULL for system / trigger entries
  table_name  TEXT          NOT NULL,
  record_id   UUID,
  action      audit_action  NOT NULL,
  payload     JSONB         NOT NULL,
  prev_hash   TEXT          NOT NULL DEFAULT '',
  hash        TEXT          NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Prevent UPDATE on audit_log
CREATE OR REPLACE FUNCTION prevent_audit_update()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows are immutable — updates are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_no_audit_update ON audit_log;
CREATE TRIGGER trg_no_audit_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();

-- Prevent DELETE on audit_log
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows are immutable — deletes are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_no_audit_delete ON audit_log;
CREATE TRIGGER trg_no_audit_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();

-- Unique index to detect hash collision / tampering
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_hash ON audit_log(hash);

-- =============================================================================
-- ESCALATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS escalations (
  id                 UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID             NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requisition_id     UUID             NOT NULL REFERENCES requisitions(id),
  tier               escalation_tier  NOT NULL DEFAULT 'Officer',
  triggered_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  acknowledged_by    UUID             REFERENCES officers(id),
  acknowledged_at    TIMESTAMPTZ,
  auto_escalated_at  TIMESTAMPTZ,     -- set when this tier was skipped due to non-ack
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ROW-LEVEL SECURITY
-- Application sets: SET LOCAL app.current_org_id = '<uuid>' in each transaction
-- =============================================================================

ALTER TABLE organisations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ref_counters ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies idempotently
DO $$ BEGIN

  -- organisations: an app session may only see its own org
  DROP POLICY IF EXISTS rls_org_self       ON organisations;
  DROP POLICY IF EXISTS rls_officers       ON officers;
  DROP POLICY IF EXISTS rls_suppliers      ON suppliers;
  DROP POLICY IF EXISTS rls_requisitions   ON requisitions;
  DROP POLICY IF EXISTS rls_deliveries     ON deliveries;
  DROP POLICY IF EXISTS rls_payments       ON payments;
  DROP POLICY IF EXISTS rls_audit_log      ON audit_log;
  DROP POLICY IF EXISTS rls_escalations    ON escalations;
  DROP POLICY IF EXISTS rls_ref_counters   ON org_ref_counters;

  CREATE POLICY rls_org_self ON organisations
    USING (id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_officers ON officers
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_suppliers ON suppliers
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_requisitions ON requisitions
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_deliveries ON deliveries
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_payments ON payments
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_audit_log ON audit_log
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_escalations ON escalations
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

  CREATE POLICY rls_ref_counters ON org_ref_counters
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

END $$;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_officers_org          ON officers(org_id);
CREATE INDEX IF NOT EXISTS idx_officers_phone        ON officers(phone_number);
CREATE INDEX IF NOT EXISTS idx_officers_invite_token ON officers(invite_token) WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_org         ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_blacklist   ON suppliers(org_id, is_blacklisted);

CREATE INDEX IF NOT EXISTS idx_requisitions_org      ON requisitions(org_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status   ON requisitions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_requisitions_sla      ON requisitions(sla_deadline) WHERE status = 'Ordered';
CREATE INDEX IF NOT EXISTS idx_requisitions_created  ON requisitions(org_id, created_by);

CREATE INDEX IF NOT EXISTS idx_deliveries_req        ON deliveries(requisition_id);
CREATE INDEX IF NOT EXISTS idx_payments_req          ON payments(requisition_id);
CREATE INDEX IF NOT EXISTS idx_payments_delivery     ON payments(delivery_id);

CREATE INDEX IF NOT EXISTS idx_audit_org_time        ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record          ON audit_log(table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_escalations_org       ON escalations(org_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_open      ON escalations(requisition_id)
  WHERE acknowledged_at IS NULL;

COMMIT;
