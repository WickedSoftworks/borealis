import { betterAuth } from "better-auth";
import { Pool } from "pg";

const database = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  database: database,
  baseURL: "http://localhost:3000/",
  emailAndPassword: { enabled: true },
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },
  },
});
