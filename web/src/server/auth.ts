import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned by the seed / Admin, never self-registered,
    // so nobody can mint themselves a privileged role.
    disableSignUp: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "faculty", input: false },
      department: { type: "string", required: false, input: false },
      facultyId: { type: "string", required: false, input: false },
      clubName: { type: "string", required: false, input: false },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: true, maxAge: 60 * 5 } },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
