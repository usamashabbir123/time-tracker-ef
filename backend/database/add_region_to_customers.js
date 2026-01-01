const db = require('../config/db');

async function addRegionColumn() {
  try {
    const dbName = process.env.DB_NAME || 'time_tracking';
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'region'`,
      [dbName]
    );

    const exists = rows[0].cnt > 0;
    if (exists) {
      console.log('✅ Column `region` already exists on `customers`. Nothing to do.');
      process.exit(0);
    }

    console.log('Adding `region` column to `customers` table...');
    await db.query("ALTER TABLE customers ADD COLUMN region VARCHAR(100) DEFAULT NULL;");
    console.log('✅ `region` column added successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error adding `region` column:', err);
    process.exit(1);
  }
}

addRegionColumn();

