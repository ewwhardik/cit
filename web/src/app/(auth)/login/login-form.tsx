"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type Account = { email: string; role: string; note: string };

export function LoginForm({ accounts, demoPassword }: { accounts: Account[]; demoPassword: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function signIn(e: string, p: string, key: string) {
    setBusy(key);
    setError(null);
    const { error } = await authClient.signIn.email({ email: e, password: p });
    if (error) {
      setError(error.message ?? "Sign-in failed");
      setBusy(null);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            void signIn(email, password, "form");
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-[12px] text-bad">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="w-full" loading={busy === "form"}>
            Sign in
          </Button>
        </form>
      </Card>

      <div>
        <p className="mb-2 text-[12px] text-gray-9">
          Demo accounts. Password: <span className="tabular text-gray-10">{demoPassword}</span>
        </p>
        <div className="grid gap-1.5">
          {accounts.map((a) => (
            <button
              key={a.email}
              type="button"
              disabled={busy !== null}
              onClick={() => void signIn(a.email, demoPassword, a.email)}
              className="group flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-gray-4 bg-surface px-3 py-2 text-left transition-colors duration-[120ms] hover:border-gray-6 hover:bg-gray-2 disabled:opacity-60 max-md:min-h-11"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{a.role}</span>
                <span className="block truncate text-[12px] text-gray-9">{a.note}</span>
              </span>
              <span className="tabular shrink-0 text-[11px] text-gray-8 group-hover:text-gray-9">
                {busy === a.email ? "Signing in…" : a.email}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
