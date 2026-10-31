/**
 * First-boot seed for hosted deploys: seeds demo accounts + dataset only when
 * the database has no users yet, so restarts never wipe judges' work.
 *   drizzle-kit push --force && tsx scripts/seed-if-empty.ts && next start
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { resetDemoData } from "../src/server/demo";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  const { rows } = await pool.query<{ n: string }>('select count(*) as n from "user"');
  if (Number(rows[0]?.n ?? 0) > 0) {
    console.log("Database already seeded; leaving it as is.");
    return;
  }
  const r = await resetDemoData(db, null);
  console.log(`Seeded demo users and dataset ${r.datasetId} (#${r.datasetRef}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
