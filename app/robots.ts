import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/appUrl";

/**
 * Crawlers are welcome on the marketing surface and nowhere else.
 *
 * `/s/` holds secret capability URLs: a share token IS the credential. A
 * crawler that follows one pasted in a public channel does not just index it —
 * it spends a download against the share's cap and bytes against its egress
 * ceiling, which can exhaust a burn-after-N link before the intended recipient
 * ever opens it. Disallowing these paths is the point of the product, not an
 * oversight.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: ["/s/", "/dashboard", "/api/"],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
