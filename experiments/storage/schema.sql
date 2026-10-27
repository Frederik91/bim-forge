CREATE SCHEMA qvm_storage;

CREATE TABLE qvm_storage.versions (
  version_id text PRIMARY KEY CHECK (version_id ~ '^[a-f0-9]{64}$'),
  entity_id text NOT NULL,
  kind text NOT NULL,
  type_id text, container_id text, system_id text,
  from_id text, to_id text,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  CHECK ((from_id IS NULL) = (to_id IS NULL)),
  CHECK (body->>'entityId' = entity_id AND body->>'kind' = kind)
);
CREATE TABLE qvm_storage.revisions (
  revision_id text PRIMARY KEY CHECK (revision_id ~ '^[a-f0-9]{64}$'),
  parent_id text REFERENCES qvm_storage.revisions(revision_id),
  command_id text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE qvm_storage.branches (
  branch text PRIMARY KEY,
  head text REFERENCES qvm_storage.revisions(revision_id)
);
CREATE TABLE qvm_storage.changes (
  revision_id text NOT NULL REFERENCES qvm_storage.revisions(revision_id),
  entity_id text NOT NULL,
  version_id text REFERENCES qvm_storage.versions(version_id),
  PRIMARY KEY (revision_id, entity_id)
);
CREATE INDEX changes_entity_history ON qvm_storage.changes(entity_id, revision_id);
CREATE TABLE qvm_storage.visibility (
  branch text NOT NULL REFERENCES qvm_storage.branches(branch),
  entity_id text NOT NULL,
  version_id text NOT NULL REFERENCES qvm_storage.versions(version_id),
  kind text NOT NULL,
  type_id text, container_id text, system_id text, from_id text, to_id text,
  PRIMARY KEY (branch, entity_id)
);
CREATE INDEX visibility_kind ON qvm_storage.visibility(branch, kind, entity_id);
CREATE INDEX visibility_type ON qvm_storage.visibility(branch, type_id, entity_id) WHERE type_id IS NOT NULL;
CREATE INDEX visibility_container ON qvm_storage.visibility(branch, container_id, entity_id) WHERE container_id IS NOT NULL;
CREATE INDEX visibility_system ON qvm_storage.visibility(branch, system_id, entity_id) WHERE system_id IS NOT NULL;
CREATE INDEX visibility_from ON qvm_storage.visibility(branch, from_id, entity_id) WHERE from_id IS NOT NULL;
CREATE INDEX visibility_to ON qvm_storage.visibility(branch, to_id, entity_id) WHERE to_id IS NOT NULL;
CREATE TABLE qvm_storage.receipts (
  command_id text PRIMARY KEY,
  payload_hash text NOT NULL,
  revision_id text NOT NULL UNIQUE REFERENCES qvm_storage.revisions(revision_id)
);
CREATE TABLE qvm_storage.snapshots (
  revision_id text PRIMARY KEY REFERENCES qvm_storage.revisions(revision_id),
  body jsonb NOT NULL,
  canonical_bytes bigint NOT NULL CHECK (canonical_bytes <= 262144),
  checksum text NOT NULL
);
CREATE FUNCTION qvm_storage.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable qualification history'; END;
$$;
CREATE TRIGGER immutable_versions BEFORE UPDATE OR DELETE ON qvm_storage.versions
FOR EACH ROW EXECUTE FUNCTION qvm_storage.refuse_mutation();
CREATE TRIGGER immutable_revisions BEFORE UPDATE OR DELETE ON qvm_storage.revisions
FOR EACH ROW EXECUTE FUNCTION qvm_storage.refuse_mutation();
CREATE TRIGGER immutable_changes BEFORE UPDATE OR DELETE ON qvm_storage.changes
FOR EACH ROW EXECUTE FUNCTION qvm_storage.refuse_mutation();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON qvm_storage.receipts
FOR EACH ROW EXECUTE FUNCTION qvm_storage.refuse_mutation();
CREATE TRIGGER immutable_snapshots BEFORE UPDATE OR DELETE ON qvm_storage.snapshots
FOR EACH ROW EXECUTE FUNCTION qvm_storage.refuse_mutation();
