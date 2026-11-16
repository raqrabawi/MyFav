import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { parsePostgresConnectionUri } from './uri.ts';

dotenv.config();

const supabaseDbUrl = process.env.SUPABASE_DB_URL?.trim();

function resolveDbCredentials() {
  if (supabaseDbUrl) {
    const parsed = parsePostgresConnectionUri(supabaseDbUrl);
    if (!parsed) {
      throw new Error(
        'SUPABASE_DB_URL could not be parsed as a PostgreSQL connection URI.'
      );
    }
    return parsed;
  }

  const sqlHost = process.env.SQL_HOST;
  const sqlDbName = process.env.SQL_DB_NAME;
  const user = process.env.SQL_ADMIN_USER;
  const password = process.env.SQL_ADMIN_PASSWORD;

  if (!sqlHost) {
    throw new Error('SQL_HOST (or SUPABASE_DB_URL) must be set in environment variables.');
  }
  if (!sqlDbName) {
    throw new Error('SQL_DB_NAME (or SUPABASE_DB_URL) must be set in environment variables.');
  }
  if (!user) {
    throw new Error('SQL_ADMIN_USER (or SUPABASE_DB_URL) must be set in environment variables.');
  }
  if (!password) {
    throw new Error('SQL_ADMIN_PASSWORD (or SUPABASE_DB_URL) must be set in environment variables.');
  }

  return {
    host: sqlHost,
    user,
    password,
    database: sqlDbName,
    ssl: false as const,
  };
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: resolveDbCredentials(),
  verbose: true,
});
