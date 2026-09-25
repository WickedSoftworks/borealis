import { describe, expect, test } from "bun:test";
import { GET, POST } from "./route";

describe("auth administration boundary", () => {
  for (const endpoint of [
    "/api/auth/admin/set-role",
    "/api/auth/admin/impersonate-user",
    "/api/auth/admin/remove-user",
    "/api/auth/%61dmin/set-user-password",
  ]) {
    test(`refuses ${endpoint} before dispatching to better-auth`, async () => {
      const response = await POST(
        new Request(`http://localhost:3000${endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(403);
    });
  }

  test("refuses admin GET endpoints too", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/auth/admin/list-users"),
    );
    expect(response.status).toBe(403);
  });
});
