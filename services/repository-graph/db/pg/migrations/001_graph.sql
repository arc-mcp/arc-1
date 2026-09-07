CREATE TABLE arc_graph.systems (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_key text NOT NULL UNIQUE CHECK (system_key = upper(system_key)),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE arc_graph.generations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_id bigint NOT NULL REFERENCES arc_graph.systems(id) ON DELETE RESTRICT,
  scope_name text NOT NULL,
  extractor_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('building', 'complete', 'partial', 'error')),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  node_count bigint NOT NULL DEFAULT 0,
  observation_count bigint NOT NULL DEFAULT 0
);

CREATE TABLE arc_graph.nodes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_id bigint NOT NULL REFERENCES arc_graph.systems(id) ON DELETE RESTRICT,
  object_type text NOT NULL CHECK (object_type = upper(object_type)),
  object_name text NOT NULL CHECK (object_name = upper(object_name)),
  package_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  locator text,
  resolution_status text NOT NULL CHECK (resolution_status IN ('resolved', 'unresolved', 'out_of_scope')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (system_id, object_type, object_name)
);

CREATE INDEX nodes_package_idx ON arc_graph.nodes(system_id, package_name, object_type, object_name);
CREATE INDEX nodes_name_idx ON arc_graph.nodes(system_id, object_name, object_type);
CREATE INDEX nodes_metadata_search_idx ON arc_graph.nodes
  USING gin (to_tsvector('simple', object_name || ' ' || package_name || ' ' || description));

CREATE TABLE arc_graph.edge_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_node_id bigint NOT NULL REFERENCES arc_graph.nodes(id) ON DELETE CASCADE,
  target_node_id bigint NOT NULL REFERENCES arc_graph.nodes(id) ON DELETE RESTRICT,
  relation_kind text NOT NULL CHECK (relation_kind IN (
    'belongs_to', 'inherits_from', 'implements', 'references', 'static_call',
    'function_call', 'reads_from', 'projects_on', 'associates_to', 'composes'
  )),
  evidence_owner text NOT NULL,
  evidence_method text NOT NULL,
  source_resource text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource)
);

CREATE INDEX edge_observations_outgoing_idx
  ON arc_graph.edge_observations(source_node_id, relation_kind, target_node_id);
CREATE INDEX edge_observations_incoming_idx
  ON arc_graph.edge_observations(target_node_id, relation_kind, source_node_id);
CREATE INDEX edge_observations_owner_idx
  ON arc_graph.edge_observations(source_node_id, evidence_owner, source_resource);

CREATE TABLE arc_graph.collection_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_id bigint NOT NULL REFERENCES arc_graph.systems(id) ON DELETE RESTRICT,
  scope_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'partial', 'error')),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error text
);

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arc_graph_api') THEN
    GRANT USAGE ON SCHEMA arc_graph TO arc_graph_api;
    GRANT SELECT ON ALL TABLES IN SCHEMA arc_graph TO arc_graph_api;
    ALTER DEFAULT PRIVILEGES IN SCHEMA arc_graph GRANT SELECT ON TABLES TO arc_graph_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arc_graph_writer') THEN
    GRANT USAGE ON SCHEMA arc_graph TO arc_graph_writer;
    GRANT SELECT ON ALL TABLES IN SCHEMA arc_graph TO arc_graph_writer;
    GRANT INSERT, UPDATE, DELETE ON arc_graph.systems, arc_graph.nodes,
      arc_graph.edge_observations, arc_graph.generations, arc_graph.collection_jobs TO arc_graph_writer;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA arc_graph TO arc_graph_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA arc_graph GRANT SELECT ON TABLES TO arc_graph_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA arc_graph GRANT USAGE, SELECT ON SEQUENCES TO arc_graph_writer;
  END IF;
END
$roles$;
