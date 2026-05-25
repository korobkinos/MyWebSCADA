export const ARCHIVE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tag_data_types (
    id SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tag_source_types (
    id SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS units (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archive_policies (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    mode TEXT NOT NULL DEFAULT 'on_change_with_periodic',
    period_ms INTEGER NOT NULL DEFAULT 5000,
    deadband DOUBLE PRECISION NOT NULL DEFAULT 0,
    retention_days INTEGER NOT NULL DEFAULT 365,
    aggregate_enabled BOOLEAN NOT NULL DEFAULT true,
    compression_after_days INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archive_runtime_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    auto_cleanup_enabled BOOLEAN NOT NULL DEFAULT true,
    archive_new_tags_by_default BOOLEAN NOT NULL DEFAULT false,
    max_db_size_mb INTEGER,
    max_data_age_months INTEGER,
    delete_batch_size INTEGER NOT NULL DEFAULT 500,
    maintenance_interval_ms INTEGER NOT NULL DEFAULT 3000,
    max_maintenance_tick_ms INTEGER NOT NULL DEFAULT 200,
    max_delete_transaction_ms INTEGER NOT NULL DEFAULT 150,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE archive_runtime_settings
ADD COLUMN IF NOT EXISTS delete_batch_size INTEGER NOT NULL DEFAULT 500;

ALTER TABLE archive_runtime_settings
ADD COLUMN IF NOT EXISTS maintenance_interval_ms INTEGER NOT NULL DEFAULT 3000;

ALTER TABLE archive_runtime_settings
ADD COLUMN IF NOT EXISTS max_maintenance_tick_ms INTEGER NOT NULL DEFAULT 200;

ALTER TABLE archive_runtime_settings
ADD COLUMN IF NOT EXISTS max_delete_transaction_ms INTEGER NOT NULL DEFAULT 150;

ALTER TABLE archive_runtime_settings
ADD COLUMN IF NOT EXISTS archive_new_tags_by_default BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tags (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    data_type_id SMALLINT NOT NULL REFERENCES tag_data_types(id),
    source_type_id SMALLINT REFERENCES tag_source_types(id),
    unit_id BIGINT REFERENCES units(id),
    driver_id BIGINT REFERENCES drivers(id),
    archive_policy_id BIGINT REFERENCES archive_policies(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag_groups (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS tag_group_members (
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, group_id)
);

CREATE TABLE IF NOT EXISTS tag_archive_overrides (
    tag_id BIGINT PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
    enabled BOOLEAN,
    mode TEXT,
    period_ms INTEGER,
    deadband DOUBLE PRECISION,
    retention_days INTEGER,
    aggregate_enabled BOOLEAN,
    compression_after_days INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archive_qualities (
    id SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS archive_sources (
    id SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS archive_samples (
    time TIMESTAMPTZ NOT NULL,
    tag_id BIGINT NOT NULL REFERENCES tags(id),
    value_double DOUBLE PRECISION,
    value_bool BOOLEAN,
    value_text TEXT,
    quality_id SMALLINT NOT NULL REFERENCES archive_qualities(id),
    source_id SMALLINT REFERENCES archive_sources(id),
    flags INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tag_id, time)
);

CREATE INDEX IF NOT EXISTS idx_archive_samples_tag_time
ON archive_samples (tag_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_archive_samples_time
ON archive_samples (time DESC);

CREATE INDEX IF NOT EXISTS idx_archive_samples_time_asc
ON archive_samples (time ASC);

CREATE TABLE IF NOT EXISTS archive_aggregates_1m (
    bucket TIMESTAMPTZ NOT NULL,
    tag_id BIGINT NOT NULL REFERENCES tags(id),
    min_double DOUBLE PRECISION,
    max_double DOUBLE PRECISION,
    avg_double DOUBLE PRECISION,
    first_double DOUBLE PRECISION,
    last_double DOUBLE PRECISION,
    count_values INTEGER NOT NULL DEFAULT 0,
    bad_count INTEGER NOT NULL DEFAULT 0,
    uncertain_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tag_id, bucket)
);

CREATE TABLE IF NOT EXISTS archive_events (
    id BIGSERIAL PRIMARY KEY,
    time TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    tag_id BIGINT REFERENCES tags(id),
    user_id BIGINT,
    message TEXT NOT NULL,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_archive_events_time
ON archive_events (time DESC);

CREATE INDEX IF NOT EXISTS idx_archive_events_tag_time
ON archive_events (tag_id, time DESC);

CREATE TABLE IF NOT EXISTS event_archive_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT true,
    retention_days INTEGER NOT NULL DEFAULT 90,
    max_database_size_mb INTEGER NOT NULL DEFAULT 2048,
    cleanup_mode TEXT NOT NULL DEFAULT 'byAgeAndSize' CHECK (cleanup_mode IN ('byAge', 'bySize', 'byAgeAndSize')),
    cleanup_interval_minutes INTEGER NOT NULL DEFAULT 60,
    optimize_after_cleanup BOOLEAN NOT NULL DEFAULT false,
    delete_batch_size INTEGER NOT NULL DEFAULT 500,
    maintenance_interval_ms INTEGER NOT NULL DEFAULT 3000,
    max_maintenance_tick_ms INTEGER NOT NULL DEFAULT 200,
    max_delete_transaction_ms INTEGER NOT NULL DEFAULT 150,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_archive_settings
ADD COLUMN IF NOT EXISTS delete_batch_size INTEGER NOT NULL DEFAULT 500;

ALTER TABLE event_archive_settings
ADD COLUMN IF NOT EXISTS maintenance_interval_ms INTEGER NOT NULL DEFAULT 3000;

ALTER TABLE event_archive_settings
ADD COLUMN IF NOT EXISTS max_maintenance_tick_ms INTEGER NOT NULL DEFAULT 200;

ALTER TABLE event_archive_settings
ADD COLUMN IF NOT EXISTS max_delete_transaction_ms INTEGER NOT NULL DEFAULT 150;

CREATE TABLE IF NOT EXISTS event_occurrences (
    id BIGSERIAL PRIMARY KEY,
    event_definition_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    cleared_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'cleared', 'acknowledged')),
    source_tag_name_snapshot TEXT,
    category_id_snapshot TEXT,
    category_name_snapshot TEXT,
    priority_snapshot INTEGER,
    message_text_snapshot TEXT,
    value_at_trigger TEXT,
    value_at_clear TEXT,
    quality TEXT,
    runtime_source TEXT,
    service_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_occurred_at
ON event_occurrences (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_event_definition_id
ON event_occurrences (event_definition_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_state
ON event_occurrences (state);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_category
ON event_occurrences (category_name_snapshot, category_id_snapshot);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_priority
ON event_occurrences (priority_snapshot);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_source
ON event_occurrences (source_tag_name_snapshot);

CREATE TABLE IF NOT EXISTS operator_actions (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    user_id TEXT,
    username TEXT,
    user_role TEXT,
    ip TEXT,

    screen_id TEXT,
    screen_name TEXT,

    object_id TEXT NOT NULL,
    object_name TEXT,
    object_description TEXT,
    object_type TEXT NOT NULL,

    action_kind TEXT NOT NULL,
    target_type TEXT,
    target_name TEXT,

    old_value TEXT,
    new_value TEXT,
    unit TEXT,

    message_template TEXT,
    message_text TEXT NOT NULL,

    result TEXT NOT NULL DEFAULT 'success',
    error_text TEXT,

    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_actions_occurred_at
ON operator_actions (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_username_occurred_at
ON operator_actions (username, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_object_id_occurred_at
ON operator_actions (object_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_target_name_occurred_at
ON operator_actions (target_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_result_occurred_at
ON operator_actions (result, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_action_kind_occurred_at
ON operator_actions (action_kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS archive_alarms (
    id BIGSERIAL PRIMARY KEY,
    tag_id BIGINT REFERENCES tags(id),
    alarm_code TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    appeared_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by BIGINT,
    cleared_at TIMESTAMPTZ,
    state TEXT NOT NULL,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_archive_alarms_tag_appeared
ON archive_alarms (tag_id, appeared_at DESC);

CREATE INDEX IF NOT EXISTS idx_archive_alarms_state
ON archive_alarms (state);

INSERT INTO tag_data_types (code)
VALUES ('BOOL'), ('INT'), ('UINT'), ('DINT'), ('UDINT'), ('REAL'), ('STRING')
ON CONFLICT (code) DO NOTHING;

INSERT INTO tag_source_types (code)
VALUES ('opcua'), ('modbus'), ('lw'), ('internal'), ('computed'), ('simulated')
ON CONFLICT (code) DO NOTHING;

INSERT INTO archive_qualities (code)
VALUES ('Good'), ('Uncertain'), ('Bad')
ON CONFLICT (code) DO NOTHING;

INSERT INTO archive_sources (code)
VALUES ('modbus'), ('opcua'), ('simulated'), ('manual'), ('internal'), ('init')
ON CONFLICT (code) DO NOTHING;

INSERT INTO archive_runtime_settings (
    id,
    auto_cleanup_enabled,
    max_db_size_mb,
    max_data_age_months,
    delete_batch_size,
    maintenance_interval_ms,
    max_maintenance_tick_ms,
    max_delete_transaction_ms
)
VALUES (1, true, 5120, NULL, 500, 3000, 200, 150)
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_archive_settings (
    id,
    enabled,
    retention_days,
    max_database_size_mb,
    cleanup_mode,
    cleanup_interval_minutes,
    optimize_after_cleanup,
    delete_batch_size,
    maintenance_interval_ms,
    max_maintenance_tick_ms,
    max_delete_transaction_ms
)
VALUES (1, true, 90, 2048, 'byAgeAndSize', 60, false, 500, 3000, 200, 150)
ON CONFLICT (id) DO NOTHING;
`;

export const ARCHIVE_TIMESCALE_SQL = `
DO $$
BEGIN
    IF to_regproc('create_hypertable') IS NOT NULL THEN
        PERFORM create_hypertable('archive_samples', 'time', if_not_exists => TRUE);
    END IF;
END $$;
`;
