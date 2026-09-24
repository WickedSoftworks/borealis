import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), twoFactorClient(), passkeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
