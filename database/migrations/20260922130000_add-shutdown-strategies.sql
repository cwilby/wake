CREATE TABLE shutdown_strategy (
    id INT NOT NULL AUTO_INCREMENT,
    instance_id INT NOT NULL,
    type ENUM('ssh', 'remote-agent') NOT NULL,
    platform ENUM('linux', 'macos', 'windows') NULL,
    host VARCHAR(255) NULL,
    private_key MEDIUMTEXT NULL,
    shutdown_command TEXT NULL,
    agent_token_hash CHAR(64) NULL,
    shutdown_request_id CHAR(36) NULL,
    shutdown_requested_at DATETIME NULL,
    agent_last_seen_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY shutdown_strategy_agent_token (agent_token_hash),
    INDEX shutdown_strategy_instance (instance_id),
    FOREIGN KEY (instance_id) REFERENCES instance(id) ON DELETE CASCADE
);
