import { describe, expect, it } from "vitest";
import { escHtml, renderMarkdown } from "./landingMarkdown.js";

describe("escHtml", () => {
  it("escapes ampersands, angle brackets", () => {
    expect(escHtml(`a & b <c>`)).toBe("a &amp; b &lt;c&gt;");
  });
});

describe("renderMarkdown", () => {
  it("renders headings and code fences", () => {
    const md = "# Title\n\n```\n<x>\n```\n";
    const html = renderMarkdown(md);
    expect(html).toContain("md-h1");
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<x>");
  });

  it("renders inline code and bold", () => {
    const html = renderMarkdown("Hello `code` and **bold**");
    expect(html).toContain("md-code");
    expect(html).toContain("<strong>");
  });

  it("renders bullet lists", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("md-ul");
    expect(html).toContain("<li>");
  });
});
