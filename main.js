import 'dotenv/config';
import database from './database/index.js';
import app from './app/index.js';
import writeLogo from './app/utils/writeLogo.js';

(async () => {
    writeLogo();
    
    await database.runMigrations();

    const port = process.env.WAKE_HTTP_PORT || 3000;
    app.listen(port, () => console.log(`Web server is running on port ${port}`));
})();
