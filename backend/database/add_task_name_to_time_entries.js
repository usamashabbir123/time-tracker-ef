const db = require('../config/db');

async function addTaskNameColumn() {
  try {
    const dbName = process.env.DB_NAME || 'time_tracking';
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'time_entries' AND COLUMN_NAME = 'task_name'`,
      [dbName]
    );

    const exists = rows[0].cnt > 0;
    if (exists) {
      console.log('✅ Column `task_name` already exists on `time_entries`. Nothing to do.');
      process.exit(0);
    }

    console.log('Adding `task_name` column to `time_entries` table...');
    await db.query("ALTER TABLE time_entries ADD COLUMN task_name VARCHAR(255) NULL;");
    console.log('✅ `task_name` column added successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error adding `task_name` column:', err);
    process.exit(1);
  }
}

addTaskNameColumn();

