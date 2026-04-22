import { resolve, join, sep } from "path";

/**
 * Safely join path segments under a root directory, guarding against directory
 * traversal via canonicalization.
 *
 * This is the canonical defence-in-depth check used for every user-supplied
 * path in the engine API. Even inputs that have already passed a regex
 * sanitization check must go through here before touching the filesystem.
 *
 * Steps:
 *   1. Join all parts with path.join(root, ...parts)
 *   2. Resolve the joined path to an absolute canonical path with path.resolve()
 *   3. Assert that the resolved path starts with path.resolve(root) + path.sep
 *      (the trailing sep prevents a "prefix attack" where root=/foo allows /foobar)
 *      OR equals path.resolve(root) exactly (for the root itself)
 *   4. Return the resolved path if safe; null otherwise
 *
 * Note: path.resolve() expands symlinks on Windows but NOT on Linux/macOS
 * (it uses lexical normalization only). If symlink following is required, use
 * fs.realpathSync() instead — but for this application lexical normalization
 * is sufficient because the root directories are created by the engine itself
 * and are not symlinked externally.
 */
export function safeJoin(root: string, ...parts: string[]): string | null {
  if (parts.some(p => !p && p !== "")) return null; // guard undefined/null parts
  const resolvedRoot = resolve(root);
  const joined = join(resolvedRoot, ...parts);
  const resolvedJoined = resolve(joined);

  // The resolved path must be either the root itself or a strict descendant.
  // The trailing sep check prevents /root-prefix-attack (e.g. /solve-extra).
  if (
    resolvedJoined === resolvedRoot ||
    resolvedJoined.startsWith(resolvedRoot + sep)
  ) {
    return resolvedJoined;
  }
  return null;
}
