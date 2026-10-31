import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations need a direct (non-pooled) connection; fall back to DATABASE_URL locally.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (and DATABASE_URL_UNPOOLED on Neon) before running drizzle-kit.");

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
