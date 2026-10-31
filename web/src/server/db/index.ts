import "server-only";
import { parseEnv } from "@neon/env";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import neonConfig from "../../../neon";
import * as schema from "./schema";

/**
 * node-postgres pool on the *pooled* Neon connection string (DATABASE_URL),
 * as recommended for Vercel Fluid compute. `attachDatabasePool` lets Vercel
 * close idle clients before a function instance is suspended. Locally the same
 * code talks to any Postgres set in DATABASE_URL. Migrations use the direct
 * (unpooled) URL - see drizzle.config.ts.
 */
const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: postgres.databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
  });
if (!globalForDb.pool) attachDatabasePool(pool);
globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
