/**
 * Seed / reset the database: demo accounts + bundled dataset.
 *   pnpm db:push && pnpm seed
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { resetDemoData } from "../src/server/demo";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://cit:cit@localhost:5432/cit",
});
const db = drizzle(pool, { schema });

resetDemoData(db, null)
  .then((r) => {
    console.log(`Seeded demo users and dataset ${r.datasetId} (#${r.datasetRef}).`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
