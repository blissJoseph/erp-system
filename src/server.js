const path = require('node:path');
const { openDatabase, seed } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.db');

const db = openDatabase(DB_FILE);
seed(db);

createApp(db).listen(PORT, () => {
  console.log(`ERP running at http://localhost:${PORT}`);
});
