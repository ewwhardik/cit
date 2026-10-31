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
          <div className="grid size-9 place-items-center rounded-[11px] bg-[#c6ff3d] font-display text-[13px] font-extrabold text-[#0c0a08]">
            C/
          </div>
          <div>
            <h1 className="font-display text-[17px] font-bold leading-tight tracking-tight">CIT Scheduler</h1>
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
