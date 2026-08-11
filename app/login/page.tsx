import { redirect } from "next/navigation";
import { Suspense } from "react";
import Login from "@/components/login";
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
    <Suspense>
      <Login providers={getEnabledProviders()} />
    </Suspense>
  );
}
