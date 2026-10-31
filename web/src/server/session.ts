import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import type { Role } from "./db/schema";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string | null;
  facultyId: string | null;
  clubName: string | null;
};

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const u = s.user as typeof s.user & Partial<CurrentUser>;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role ?? "faculty") as Role,
    department: u.department ?? null,
    facultyId: u.facultyId ?? null,
    clubName: u.clubName ?? null,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) redirect("/dashboard?denied=1");
  return u;
}
