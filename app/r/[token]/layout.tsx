import { PublicShell } from "@/components/public-shell";

/** Collection links are a hand-off too, so they share the recipient frame. */
export default function ReverseShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
