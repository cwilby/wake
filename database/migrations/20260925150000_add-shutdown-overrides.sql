ALTER TABLE shutdown_schedule
    ADD COLUMN override_date CHAR(10) NULL,
    ADD COLUMN override_action ENUM('skip', 'delay') NULL,
    ADD COLUMN override_due_at BIGINT NULL,
    ADD COLUMN revision INT NOT NULL DEFAULT 0;
