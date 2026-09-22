create table instance (
    id int not null auto_increment,
    name varchar(255) not null,
    active bit not null default 0,
    state enum('no-host', 'awake', 'asleep'),
    last_seen datetime,
    last_checked datetime,
    last_wake_request datetime,
    primary key (id),
    index (state)
);

create table instance_host (
    instance_id int not null,
    address varchar(255) not null,
    unique (instance_id, address),
    foreign key (instance_id) references instance(id)
);

create table instance_mac (
    instance_id int not null,
    address varchar(17) not null,
    unique (instance_id, address),
    foreign key (instance_id) references instance(id)
);