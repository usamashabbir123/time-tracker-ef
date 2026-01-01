const { exec } = require('child_process');
const path = require('path');

const migrations = [
  'add_customer_id_to_projects.js',
  'add_custom_fields_to_projects.js',
  'add_region_to_customers.js',
  'add_task_name_to_time_entries.js',
  'add_description_to_time_entries.js'
];

async function runMigration(scriptName) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`\n📝 Running ${scriptName}...`);
    exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr && !error) console.error(stderr);
      if (error) {
        // If column already exists, that's okay
        if (error.message.includes('already exists') || stdout.includes('already exists')) {
          console.log(`✅ ${scriptName} - Column already exists, skipping.`);
        } else {
          console.error(`⚠️  ${scriptName} - Error:`, error.message);
        }
      }
      resolve();
    });
  });
}

async function main() {
  console.log('🔄 Running all required database migrations...\n');
  
  for (const migration of migrations) {
    await runMigration(migration);
  }
  
  console.log('\n✅ All migrations completed!');
  process.exit(0);
}

main();

