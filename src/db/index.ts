import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';
import { parsePostgresConnectionUri, toPoolConfig } from './uri.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _supabaseSchemaPromise: Promise<void> | undefined;
}

export interface DbMeta {
  provider: 'supabase' | 'cloudsql' | 'supabase-invalid';
  parseError: string | null;
  hostHint: string | null;
}

function resolvePoolSetup(): { config: PoolConfig; meta: DbMeta } {
  const rawSupabaseUrl = process.env.SUPABASE_DB_URL?.trim();
  if (rawSupabaseUrl) {
    const parsed = parsePostgresConnectionUri(rawSupabaseUrl);
    if (parsed) {
      return {
        config: toPoolConfig(parsed),
        meta: {
          provider: 'supabase',
          parseError: null,
          hostHint: parsed.host,
        },
      };
    }

    console.error(
      'SUPABASE_DB_URL is set but could not be parsed as a PostgreSQL connection URI. Falling back to Cloud SQL.'
    );
    return {
      config: {
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 15000,
      },
      meta: {
        provider: 'supabase-invalid',
        parseError:
          'SUPABASE_DB_URL could not be parsed as a PostgreSQL URI (expected postgresql://user:password@host:5432/postgres).',
        hostHint: null,
      },
    };
  }

  return {
    config: {
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
    },
    meta: {
      provider: 'cloudsql',
      parseError: null,
      hostHint: process.env.SQL_HOST ? 'cloudsql' : null,
    },
  };
}

const resolvedSetup = resolvePoolSetup();
export const dbMeta: DbMeta = resolvedSetup.meta;

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(resolvedSetup.config);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

const SUPABASE_INIT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'bookmark',
    parent_id TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    subcategory_id TEXT NOT NULL DEFAULT '',
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS quick_shortcuts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    icon_type TEXT NOT NULL DEFAULT 'favicon',
    custom_icon TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    owner_id TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    theme_mode TEXT NOT NULL DEFAULT 'dark',
    primary_color TEXT NOT NULL DEFAULT 'blue',
    glass_intensity TEXT NOT NULL DEFAULT 'balanced',
    card_density TEXT NOT NULL DEFAULT 'comfortable',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS shared_categories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    category_name TEXT NOT NULL,
    category_icon TEXT NOT NULL DEFAULT 'bookmark',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    subcategories JSONB NOT NULL DEFAULT '[]'::jsonb,
    bookmarks JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
];

export async function ensureDatabaseSchema(): Promise<void> {
  if (dbMeta.provider !== 'supabase') {
    return;
  }
  if (!global._supabaseSchemaPromise) {
    global._supabaseSchemaPromise = (async () => {
      for (const ddl of SUPABASE_INIT_STATEMENTS) {
        await pool.query(ddl);
      }
    })().catch((err) => {
      global._supabaseSchemaPromise = undefined;
      throw err;
    });
  }
  return global._supabaseSchemaPromise;
}

export async function verifyDatabaseStatus() {
  await ensureDatabaseSchema();
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  return {
    provider: dbMeta.provider,
    parseError: dbMeta.parseError,
    hostHint: dbMeta.hostHint,
    tables: result.rows.map((r) => r.table_name),
  };
}
