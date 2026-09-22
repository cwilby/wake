import fs from 'fs/promises';
import path from 'path';
import db from '../app/utils/db.js';

const database = {
    async runMigrations() {
        try { 
            await db.query('SELECT * FROM migrations'); 
        } catch {
            await db.query('CREATE TABLE migrations (id int not null auto_increment, name varchar(255) not null, PRIMARY KEY (id))');
            console.log('Created migrations table');
        }

        const migrationPath = path.join(import.meta.dirname, 'migrations');
        const migrations = await fs.readdir(migrationPath);
        const { results: appliedMigrations } = await db.query('SELECT name FROM migrations');
        const appliedMigrationNames = appliedMigrations.map(m => m.name.replace('.sql', ''));

        const pendingMigrations = migrations.filter(m => !appliedMigrationNames.includes(m.replace('.sql', '')));
        
        for (const pendingMigration of pendingMigrations) {
            await db.query(await fs.readFile(path.join(migrationPath, pendingMigration), 'utf8'));
            await db.query('INSERT INTO migrations (name) VALUES (?)', [pendingMigration]);
            console.log(`Applied migration ${pendingMigration}`);
        }
    }
};

export default database;