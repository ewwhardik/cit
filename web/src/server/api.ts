import "server-only";
import { NextResponse } from "next/server";
import type { Role } from "./db/schema";
import { EngineError } from "./engine";
import { WorkflowError } from "./proposals";
import { type CurrentUser, getCurrentUser } from "./session";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Route-handler guard: returns the user or a 401/403 response. */
export async function guard(...roles: Role[]): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in required", 401);
  if (roles.length && !roles.includes(user.role)) return jsonError("Your role cannot do this", 403);
  return user;
}

export function engineFailure(err: unknown) {
  if (err instanceof WorkflowError) return jsonError(err.message, err.status);
  if (err instanceof EngineError) return jsonError(err.message, err.status >= 500 ? 502 : err.status, { detail: err.detail });
  return jsonError((err as Error).message ?? "Unexpected error", 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
