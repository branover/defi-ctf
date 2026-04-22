/**
 * Unit tests for pathUtils.safeJoin
 *
 * safeJoin is the canonical defence-in-depth path canonicalization helper used
 * by every user-supplied path in the engine API. These tests verify:
 *  - Normal descendant paths are allowed.
 *  - The root itself is allowed.
 *  - Any path that resolves outside the root returns null.
 *  - The prefix-attack guard prevents /root-lookalike paths (e.g. /solve-extra).
 */

import { describe, it, expect } from "vitest";
import { resolve, join } from "path";
import { safeJoin } from "./pathUtils.js";

const ROOT = "/tmp/test-safe-join-root";

describe("safeJoin — allowed paths", () => {
  it("returns the root itself when no parts are provided", () => {
    const result = safeJoin(ROOT);
    expect(result).toBe(resolve(ROOT));
  });

  it("allows a simple filename under root", () => {
    const result = safeJoin(ROOT, "file.txt");
    expect(result).toBe(join(resolve(ROOT), "file.txt"));
  });

  it("allows a nested path under root", () => {
    const result = safeJoin(ROOT, "sub", "dir", "file.txt");
    expect(result).toBe(join(resolve(ROOT), "sub", "dir", "file.txt"));
  });

  it("allows a relative path with redundant dots that stays inside root", () => {
    const result = safeJoin(ROOT, "sub/../other/file.txt");
    expect(result).toBe(join(resolve(ROOT), "other", "file.txt"));
  });

  it("normalises a trailing slash on root without rejecting the path", () => {
    const result = safeJoin(ROOT + "/", "file.txt");
    expect(result).toBe(join(resolve(ROOT), "file.txt"));
  });
});

describe("safeJoin — directory traversal attempts (must return null)", () => {
  it("rejects a simple .. escape", () => {
    expect(safeJoin(ROOT, "..")).toBeNull();
  });

  it("rejects a chained .. escape", () => {
    expect(safeJoin(ROOT, "../../etc/passwd")).toBeNull();
  });

  it("rejects a deep path that escapes via ..", () => {
    expect(safeJoin(ROOT, "sub/../../etc/passwd")).toBeNull();
  });

  it("an absolute-looking part is treated as a relative segment by path.join and stays inside root", () => {
    // Node's path.join() does NOT treat a leading slash in non-first args as the root.
    // path.join("/root", "/etc/passwd") → "/root/etc/passwd" (still inside root).
    // safeJoin therefore returns a path inside root, not null.
    // The real escape vector is ".." not leading slashes — covered by other tests.
    const result = safeJoin(ROOT, "/etc/passwd");
    expect(result).toBe(join(resolve(ROOT), "etc", "passwd"));
  });

  it("rejects URL-encoded dot-dot that would escape after decoding", () => {
    // decodeURIComponent is caller responsibility; safeJoin receives the decoded string.
    // Simulate what a decoded traversal looks like.
    expect(safeJoin(ROOT, "..%2Fetc%2Fpasswd".replace(/%2F/gi, "/"))).toBeNull();
  });
});

describe("safeJoin — prefix-attack prevention", () => {
  it("rejects a sibling directory that shares the root prefix", () => {
    // e.g. root = /solve, attempt = /solve-extra/file
    const siblingRoot = "/tmp/test-safe-join-root-extra";
    // The resolved sibling starts with ROOT but is not a descendant of ROOT.
    expect(safeJoin(ROOT, "../test-safe-join-root-extra/file.txt")).toBeNull();
  });
});

describe("safeJoin — edge cases", () => {
  it("allows the empty string part (treated as a no-op segment)", () => {
    // path.join ignores empty strings
    const result = safeJoin(ROOT, "sub", "", "file.txt");
    expect(result).toBe(join(resolve(ROOT), "sub", "file.txt"));
  });

  it("returns null for an undefined part (guards against accidental undefined)", () => {
    // TypeScript callers should never pass undefined, but JS callers might.
    expect(safeJoin(ROOT, undefined as unknown as string)).toBeNull();
  });
});
