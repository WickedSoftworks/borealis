import { isRoot, ROLE_ADMIN, ROLE_ROOT, ROLE_USER } from "@/lib/invites";

export type Actor = { id: string; role?: string | null };
export type Owner = { id: string; role?: string | null };

/**
 * Who may delete whose files.
 *
 *   root   — anyone's.
 *   admin  — their own, plus any ordinary user's. NOT another admin's, and not
 *            root's.
 *   user   — only their own.
 *
 * The admin/admin boundary is the whole point of this instance's trust model:
 * admins do not have authority over each other, so an admin must not be able to
 * destroy a peer's data. Root is the only account that outranks everyone.
 */
export function canDeleteFile(actor: Actor, owner: Owner): boolean {
  if (isRoot(actor.role)) return true;

  // Always allowed to delete your own, whatever your role.
  if (actor.id === owner.id) return true;

  if (actor.role === ROLE_ADMIN) {
    // Reaching another admin's or root's files is refused.
    return owner.role !== ROLE_ADMIN && owner.role !== ROLE_ROOT;
  }

  return false;
}

/** The same rule, expressed as a Prisma filter for list/bulk operations. */
export function deletableFileWhere(actor: Actor) {
  if (isRoot(actor.role)) return {};

  if (actor.role === ROLE_ADMIN) {
    return {
      OR: [
        { ownerId: actor.id },
        // `role: null` counts as an ordinary user — the column is nullable and
        // pre-invite accounts may not have it set.
        { owner: { role: ROLE_USER } },
        { owner: { role: null } },
      ],
    };
  }

  return { ownerId: actor.id };
}

/** Whether the actor can see files beyond their own at all. */
export function canBrowseAllFiles(actor: Actor): boolean {
  return actor.role === ROLE_ADMIN || isRoot(actor.role);
}
