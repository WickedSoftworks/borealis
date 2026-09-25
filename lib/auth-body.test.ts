import { describe, expect, test } from "bun:test";
import { boundedAuthBody } from "./auth-body";

describe("boundedAuthBody", () => {
  test("accepts an ordinary JSON request", async () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      body: '{"email":"a@example.test"}',
    });
    const body = await boundedAuthBody(request);
    expect(body).not.toBeNull();
    expect(new TextDecoder().decode(body ?? undefined)).toBe(
      '{"email":"a@example.test"}',
    );
  });

  test("rejects a declared oversized body before reading it", async () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-length": "65537" },
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    expect(await boundedAuthBody(request)).toBeNull();
  });

  test("rejects a chunked oversized body after the first excessive chunk", async () => {
    let reads = 0;
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      body: new ReadableStream({
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(40_000));
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await boundedAuthBody(request)).toBeNull();
    expect(reads).toBeLessThan(4);
  });
});
