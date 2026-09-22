import mysql from 'mysql2/promise';

async function createConnection() {
    return mysql.createConnection({
        host: process.env.WAKE_MYSQL_HOST || 'mysql',
        user: process.env.WAKE_MYSQL_USERNAME || 'wake',
        password: process.env.WAKE_MYSQL_PASSWORD || 'wake',
        database: process.env.WAKE_MYSQL_DATABASE || 'wake',
        multipleStatements: true
    });
}

function createDb(connection = null) {
    return {
        async usingConnection(action) {
            const ownConnection = connection === null;
            const currentConnection = connection ?? await createConnection();

            try {
                return await action(currentConnection);
            } finally {
                if (ownConnection) {
                    await currentConnection.end();
                }
            }
        },

        async usingTransaction(action) {
            const transactionConnection = await createConnection();

            try {
                await transactionConnection.beginTransaction();

                try {
                    const transactionDb = createDb(transactionConnection);
                    const result = await action(transactionDb);

                    await transactionConnection.commit();

                    return result;
                } catch (error) {
                    await transactionConnection.rollback();
                    throw error;
                }
            } finally {
                await transactionConnection.end();
            }
        },

        query(sql, ...parameters) {
            return this.usingConnection(async connection => {
                const [results, fields] =
                    await connection.query(sql, ...parameters);

                return { results, fields };
            });
        },

        async find(table, id) {
            const { results } = await this.query(
                'SELECT * FROM ?? WHERE id = ? LIMIT 1',
                [table, id]
            );

            return results[0] ?? null;
        },

        async insert(table, row) {
            return this.query(
                'INSERT INTO ?? SET ?',
                [table, row]
            );
        },

        async bulkInsert(table, rows) {
            if (rows.length === 0) {
                return;
            }

            const headers = Object.keys(rows[0]);

            return this.query(
                'INSERT INTO ?? (??) VALUES ?',
                [
                    table,
                    headers,
                    rows.map(row => Object.values(row))
                ]
            );
        },

        async create(table, data) {
            const { results } = await this.insert(table, data);

            data.id = results.insertId;

            return data;
        },

        update(table, id, data) {
            if (typeof id === 'object') {
                const conditions = Object.keys(id)
                    .map(() => '?? = ?')
                    .join(' AND ');

                return this.query(
                    `UPDATE ?? SET ? WHERE ${conditions}`,
                    [
                        table,
                        data,
                        ...Object.entries(id).flat()
                    ]
                );
            }

            return this.query(
                'UPDATE ?? SET ? WHERE id = ?',
                [table, data, id]
            );
        },

        delete(table, id) {
            return this.query(
                'DELETE FROM ?? WHERE id = ?',
                [table, id]
            );
        }
    };
}

export default createDb();