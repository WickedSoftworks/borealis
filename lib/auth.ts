import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    // Better Auth uses secure, HttpOnly, SameSite=Lax cookies out-of-the-box
    // Enable cross-site request forgery protection
    crossSubDomainCookies: {
      enabled: false,
    },
  },
  // Future OAuth configuration goes here
  socialProviders: {
    // e.g. github: { clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET }
  },
});
