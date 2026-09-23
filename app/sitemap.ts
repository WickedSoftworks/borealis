import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/appUrl";

/**
 * Public routes only.
 *
 * Share tokens are deliberately absent and must stay that way — enumerating
 * them here would publish every link the operator has ever sent.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();

  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
