/**
 * Roles and who outranks whom.
 *
 * Its own module, with no imports, because client components need these
 * names too: they used to come from lib/invites.ts, which pulls in
 * `node:crypto`, and so dragged a server-only module into the browser bundle.
 */

export const ROLE_ROOT = "root";
export const ROLE_ADMIN = "admin";
export const ROLE_USER = "user";

/** The seeded root account. Never created through sign-up. */
export const ROOT_USER_ID = "0";

export function isRoot(role: string | null | undefined): boolean {
  return role === ROLE_ROOT;
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === ROLE_ROOT || role === ROLE_ADMIN;
}

/**
 * Who may mint what.
 *
 * Admins can invite users but not other admins: the trust model the operator
 * chose is that admins do not have control over each other, and minting a peer
 * admin is exactly that control. Only root widens the circle.
 */
export function canMintRole(
  minterRole: string | null | undefined,
  grantsRole: string,
): boolean {
  if (grantsRole === ROLE_ROOT) return false;
  if (grantsRole === ROLE_ADMIN) return isRoot(minterRole);

  return isAdmin(minterRole);
}
