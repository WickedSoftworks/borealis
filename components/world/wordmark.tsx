import { cn } from "@/lib/utils";

/**
 * The product's name as a mark: lowercase italic serif with the aurora
 * gradient. Real text, so it is read and selected like any other word.
 */
export function Wordmark({
  as: Tag = "span",
  className,
}: {
  /** Render as the page heading where the name is the heading. */
  as?: "span" | "h1";
  className?: string;
}) {
  return <Tag className={cn("wordmark", className)}>borealis</Tag>;
}
