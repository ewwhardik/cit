import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEMO_ACCOUNTS, DEMO_PASSWORD_DEFAULT } from "@/lib/demo";
import { getCurrentUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-accent text-[13px] font-semibold text-accent-fg">
            C
          </div>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight">CIT Scheduler</h1>
            <p className="text-[12px] text-gray-9">Chilika Institute of Technology</p>
          </div>
        </div>
        <LoginForm
          accounts={DEMO_ACCOUNTS.map((a) => ({ ...a }))}
          demoPassword={process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT}
        />
      </div>
    </main>
  );
}
