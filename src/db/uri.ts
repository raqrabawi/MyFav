import type { PoolConfig } from 'pg';

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface ParsedPostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: { rejectUnauthorized: false };
}

export function parsePostgresConnectionUri(
  rawInput: string | undefined
): ParsedPostgresConfig | null {
  if (!rawInput) return null;
  let value = rawInput.trim();
  if (!value) return null;

  // Strip optional env assignment or `psql ` prefix if pasted directly from docs/CLI
  value = value.replace(/^[A-Z0-9_]+\s*=\s*/i, '').trim();
  value = value.replace(/^psql\s+/i, '').trim();

  // Strip surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch && !/^postgres(ql)?$/i.test(schemeMatch[1])) {
    return null;
  }

  const withoutScheme = schemeMatch
    ? value.slice(schemeMatch[0].length)
    : value;

  const lastAtIdx = withoutScheme.lastIndexOf('@');
  if (lastAtIdx <= 0) {
    return null;
  }

  const userInfo = withoutScheme.slice(0, lastAtIdx);
  const hostAndPath = withoutScheme.slice(lastAtIdx + 1).trim();
  if (!hostAndPath) {
    return null;
  }

  const firstColonIdx = userInfo.indexOf(':');
  const user =
    firstColonIdx === -1
      ? safeDecodeUriComponent(userInfo)
      : safeDecodeUriComponent(userInfo.slice(0, firstColonIdx));
  const password =
    firstColonIdx === -1
      ? ''
      : safeDecodeUriComponent(userInfo.slice(firstColonIdx + 1));

  const slashIdx = hostAndPath.indexOf('/');
  const queryIdx = hostAndPath.indexOf('?');
  const hostEndIdx =
    slashIdx !== -1 && (queryIdx === -1 || slashIdx < queryIdx)
      ? slashIdx
      : queryIdx !== -1
      ? queryIdx
      : hostAndPath.length;

  const hostPort = hostAndPath.slice(0, hostEndIdx).trim();
  if (!hostPort) return null;

  let host = hostPort;
  let port = 5432;
  const portMatch = hostPort.match(/^(.+):(\d+)$/);
  if (portMatch) {
    host = portMatch[1].replace(/^\[|\]$/g, '');
    port = Number(portMatch[2]) || 5432;
  }

  let database = 'postgres';
  if (slashIdx !== -1) {
    const dbPart = hostAndPath
      .slice(
        slashIdx + 1,
        queryIdx !== -1 && queryIdx > slashIdx ? queryIdx : undefined
      )
      .trim();
    if (dbPart) {
      database = safeDecodeUriComponent(dbPart);
    }
  }

  if (!host || !user) return null;

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  };
}

export function toPoolConfig(parsed: ParsedPostgresConfig): PoolConfig {
  return {
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
    ssl: parsed.ssl,
    max: 10,
    connectionTimeoutMillis: 15000,
  };
}
