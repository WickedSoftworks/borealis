import { describe, expect, test } from "bun:test";
import { canDeleteFile } from "./permissions";

const root = { id: "0", role: "root" };
const adminA = { id: "a1", role: "admin" };
const adminB = { id: "a2", role: "admin" };
const userA = { id: "u1", role: "user" };
const userB = { id: "u2", role: "user" };
/** Pre-invite accounts may have no role set; they count as ordinary users. */
const legacy = { id: "u3", role: null };

describe("canDeleteFile", () => {
  test("root can delete anyone's files", () => {
    for (const owner of [root, adminA, adminB, userA, legacy]) {
      expect(canDeleteFile(root, owner)).toBe(true);
    }
  });

  test("everyone can delete their own files", () => {
    for (const actor of [root, adminA, userA, legacy]) {
      expect(canDeleteFile(actor, actor)).toBe(true);
    }
  });

  test("an admin can delete an ordinary user's files", () => {
    expect(canDeleteFile(adminA, userA)).toBe(true);
    expect(canDeleteFile(adminA, userB)).toBe(true);
    expect(canDeleteFile(adminA, legacy)).toBe(true);
  });

  test("an admin CANNOT delete another admin's files", () => {
    expect(canDeleteFile(adminA, adminB)).toBe(false);
    expect(canDeleteFile(adminB, adminA)).toBe(false);
  });

  test("an admin CANNOT delete root's files", () => {
    expect(canDeleteFile(adminA, root)).toBe(false);
  });

  test("a user cannot delete anyone else's files", () => {
    for (const owner of [userB, adminA, root, legacy]) {
      expect(canDeleteFile(userA, owner)).toBe(false);
    }
  });

  test("an unknown or absent role has no authority beyond its own files", () => {
    const stranger = { id: "x", role: "something-else" };

    expect(canDeleteFile(stranger, stranger)).toBe(true);
    expect(canDeleteFile(stranger, userA)).toBe(false);
    expect(canDeleteFile(stranger, adminA)).toBe(false);
  });

  test("role is never trusted over identity for a different id", () => {
    // Same role, different account: no implicit peer authority anywhere.
    expect(canDeleteFile(userA, { id: "u9", role: "user" })).toBe(false);
    expect(canDeleteFile(adminA, { id: "a9", role: "admin" })).toBe(false);
  });
});
