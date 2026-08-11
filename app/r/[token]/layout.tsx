/** Reverse shares are a hand-off too, so they run in the amber register. */
export default function ReverseShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="register-amber flex min-h-full flex-1 flex-col bg-ground">
      {children}
    </div>
  );
}
