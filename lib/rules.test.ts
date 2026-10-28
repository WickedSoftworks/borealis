import { describe, expect, test } from "bun:test";
import { renderRules } from "./rules";

describe("renderRules", () => {
  test("formats Markdown", () => {
    expect(renderRules("# Rules\n\n- be kind")).toBe(
      "<h1>Rules</h1>\n<ul>\n<li>be kind</li>\n</ul>\n",
    );
  });

  test("escapes raw HTML instead of passing it through", () => {
    const html = renderRules(
      '<script>alert(1)</script>\n\n<img src=x onerror="x()">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  test("refuses script links and opens real ones safely", () => {
    expect(renderRules("[x](javascript:alert(1))")).not.toContain("href=");
    expect(renderRules("[docs](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">docs</a>',
    );
  });
});
