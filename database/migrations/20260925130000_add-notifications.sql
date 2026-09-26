ALTER TABLE shutdown_schedule
    ADD COLUMN warning_minutes INT NOT NULL DEFAULT 10,
    ADD COLUMN last_warning_date CHAR(10) NULL;

CREATE TABLE notification (
    id INT NOT NULL AUTO_INCREMENT,
    instance_id INT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at VARCHAR(24) NOT NULL,
    expires_at BIGINT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (instance_id) REFERENCES instance(id) ON DELETE SET NULL
);
