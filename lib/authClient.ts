import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  secret: process.env.NEXT_PUBLIC_APP_SECRET, // e.g. a random string
  baseURL: process.env.NEXT_PUBLIC_APP_URL, // e.g. http://localhost:3000
});
