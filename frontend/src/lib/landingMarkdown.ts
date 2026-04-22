/** Escape HTML entities for safe insertion into innerHTML. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(text: string): string {
  let s = escHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code class=\"md-code\">$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "<span class=\"md-link\">$1</span>");
  return s;
}

/** Minimal markdown subset for challenge README rendering. */
export function renderMarkdown(md: string): string {
  const lines   = md.split("\n");
  const out: string[] = [];
  let inCode    = false;
  let codeLines: string[] = [];
  let listBuf:  string[] = [];
  let tableRows: string[][] = [];
  let tablePhase: "none" | "header" | "body" = "none";
  let inSpoiler = false;

  function flushList() {
    if (listBuf.length) {
      out.push(`<ul class="md-ul">${listBuf.map(l => `<li>${l}</li>`).join("")}</ul>`);
      listBuf = [];
    }
  }

  function parseTableRow(line: string): string[] {
    return line.split("|").slice(1, -1).map(c => c.trim());
  }

  function isSeparatorRow(line: string): boolean {
    // Each cell must be whitespace + optional colon + one-or-more dashes + optional colon + whitespace
    return /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    const [header, ...body] = tableRows;
    const th = header.map(c => `<th class="md-th">${inlineMd(c)}</th>`).join("");
    const rows = body.map(r => `<tr>${r.map(c => `<td class="md-td">${inlineMd(c)}</td>`).join("")}</tr>`).join("");
    out.push(`<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`);
    tableRows = [];
    tablePhase = "none";
  }

  /** Flush all open block-level state (list, table, unclosed code) before a structural boundary. */
  function flushAll() {
    flushList();
    flushTable();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Spoiler block open: ::: spoiler <Title> ────────────────────────────
    if (!inCode && /^:::\s*spoiler\b/.test(line.trim())) {
      flushAll();
      const title = line.trim().replace(/^:::\s*spoiler\s*/i, "").trim() || "Hint";
      out.push(`<details class="md-spoiler"><summary class="md-spoiler-summary">${escHtml(title)}</summary><div class="md-spoiler-body">`);
      inSpoiler = true;
      continue;
    }

    // ── Spoiler block close: ::: ───────────────────────────────────────────
    if (!inCode && inSpoiler && line.trim() === ":::") {
      flushAll();
      out.push(`</div></details>`);
      inSpoiler = false;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      if (inCode) {
        out.push(`<pre class="md-pre"><code>${escHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false; codeLines = [];
      } else { inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (isSeparatorRow(trimmed)) {
        // Separator row — switch from header to body phase; don't push a data row
        tablePhase = "body";
        continue;
      }
      flushList();
      tableRows.push(parseTableRow(trimmed));
      tablePhase = tablePhase === "none" ? "header" : "body";
      continue;
    }
    // If we were in a table and hit a non-table line, flush it first
    if (tablePhase !== "none") flushTable();

    if (line.startsWith("### ")) { flushList(); out.push(`<h3 class="md-h3">${inlineMd(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { flushList(); out.push(`<h2 class="md-h2">${inlineMd(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { flushList(); out.push(`<h1 class="md-h1">${inlineMd(line.slice(2))}</h1>`); continue; }

    if (line.match(/^[-*] /)) { listBuf.push(inlineMd(line.slice(2))); continue; }

    if (line.trim() === "") {
      flushList();
      out.push("<br class=\"md-br\">");
      continue;
    }

    flushList();
    out.push(`<p class="md-p">${inlineMd(line)}</p>`);
  }

  flushList();
  flushTable();
  // Close any unclosed spoiler block
  if (inSpoiler) {
    out.push(`</div></details>`);
  }
  if (inCode && codeLines.length) {
    out.push(`<pre class="md-pre"><code>${escHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}
