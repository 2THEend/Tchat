/**
 * Supabase Migration Runner
 * Executes migrations against the remote Supabase project using the Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN and VITE_SUPABASE_URL or project ref.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';

// Extract project ref from SUPABASE_URL (e.g., https://jqghykhnnrfsjkkjhekf.supabase.co -> jqghykhnnrfsjkkjhekf)
const projectRefMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
const projectRef = process.env.SUPABASE_PROJECT_REF || (projectRefMatch ? projectRefMatch[1] : 'jqghykhnnrfsjkkjhekf');

if (!token) {
  console.error('Error: SUPABASE_ACCESS_TOKEN environment variable is required.');
  process.exit(1);
}

if (!projectRef) {
  console.error('Error: Could not determine Supabase project ref.');
  process.exit(1);
}

console.log(`Connecting to Supabase Management API for project: ${projectRef}`);

function executeSql(query) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query });

    const req = https.request(
      {
        hostname: 'api.supabase.com',
        path: `/v1/projects/${projectRef}/database/query`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(responseBody);
              resolve(parsed);
            } catch {
              resolve(responseBody);
            }
          } else {
            reject(new Error(`API responded with ${res.statusCode}: ${responseBody}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runMigrationFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n======================================================`);
  console.log(`Executing migration: ${fileName}`);
  console.log(`======================================================`);

  const sql = fs.readFileSync(filePath, 'utf8');
  const startTime = Date.now();

  try {
    const result = await executeSql(sql);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Migration completed successfully in ${duration}s.`);
    return result;
  } catch (error) {
    console.error(`✗ Migration failed:`, error.message);
    throw error;
  }
}

async function main() {
  const targetFile = process.argv[2];

  if (targetFile) {
    const fullPath = path.resolve(process.cwd(), targetFile);
    await runMigrationFile(fullPath);
  } else {
    // Run the streaks migration by default if specified or prompt
    const streaksMigration = path.resolve(
      process.cwd(),
      'supabase/migrations/20260915040000_create_tchat_streaks.sql'
    );
    await runMigrationFile(streaksMigration);
  }

  // Verify created tables
  console.log('\n--- Verifying public tables in Supabase ---');
  const tables = await executeSql(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
  );
  console.log('Tables:', Array.isArray(tables) ? tables.map((t) => t.table_name).join(', ') : tables);

  console.log('\n--- Verifying streak routines ---');
  const routines = await executeSql(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE '%streak%' ORDER BY routine_name;"
  );
  console.log('Routines:', Array.isArray(routines) ? routines.map((r) => r.routine_name).join(', ') : routines);
}

main().catch((err) => {
  console.error('\nFatal error executing migration:', err);
  process.exit(1);
});
