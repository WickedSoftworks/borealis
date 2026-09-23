import { Suspense } from "react";
import { ResetForm } from "@/components/reset-form";

export const metadata = {
  title: "Reset password",
  description: "Reset the password on your Borealis account.",
  robots: { index: false, follow: false },
};

export default function ResetPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}
