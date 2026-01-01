const db = require('../config/db');

async function addCustomFieldsColumn() {
  try {
    const dbName = process.env.DB_NAME || 'time_tracking';
    const [rows] = await db.query(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'custom_fields'`,
      [dbName]
    );

    const exists = rows[0].cnt > 0;
    if (exists) {
      console.log('✅ Column `custom_fields` already exists on `projects`. Nothing to do.');
      process.exit(0);
    }

    console.log('Adding `custom_fields` column to `projects` table...');
    await db.query("ALTER TABLE projects ADD COLUMN custom_fields TEXT NULL;");
    console.log('✅ `custom_fields` column added successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error adding `custom_fields` column:', err);
    process.exit(1);
  }
}

addCustomFieldsColumn();

