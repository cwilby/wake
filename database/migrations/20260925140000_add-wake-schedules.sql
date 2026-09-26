CREATE TABLE wake_schedule (
    instance_id INT NOT NULL,
    enabled BIT NOT NULL DEFAULT 0,
    time_of_day CHAR(5) NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    last_run_date CHAR(10) NULL,
    last_run_at VARCHAR(24) NULL,
    last_result TEXT NULL,
    PRIMARY KEY (instance_id),
    FOREIGN KEY (instance_id) REFERENCES instance(id) ON DELETE CASCADE
);
