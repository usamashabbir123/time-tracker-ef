const db = require('../config/db');

async function addCustomerIdColumn() {
  try {
    const dbName = process.env.DB_NAME || 'time_tracking';
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'customer_id'`,
      [dbName]
    );

    const exists = rows[0].cnt > 0;
    if (exists) {
      console.log('✅ Column `customer_id` already exists on `projects`. Nothing to do.');
      process.exit(0);
    }

    console.log('Adding `customer_id` column to `projects` table...');
    await db.query("ALTER TABLE projects ADD COLUMN customer_id INT NULL;");
    console.log('✅ `customer_id` column added successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error adding `customer_id` column:', err);
    process.exit(1);
  }
}

addCustomerIdColumn();

