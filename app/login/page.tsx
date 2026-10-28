import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Login from "@/components/login";
import { readConfigFile } from "@/lib/config-file";
import { getSession } from "@/lib/session";
import { getEnabledProviders } from "@/lib/socialProviders";

export const metadata = {
  title: "Sign in",
  description: "Sign in to your Borealis instance.",
  alternates: { canonical: "/login" },
};

export default async function LoginPage() {
  if (await getSession()) {
    redirect("/dashboard");
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <Suspense>
        <Login providers={getEnabledProviders()} />
      </Suspense>
      {readConfigFile().rules !== null && (
        <Link href="/rules" className="link-quiet text-[13px]">
          Rules of this instance
        </Link>
      )}
    </div>
  );
}
