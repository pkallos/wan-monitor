#!/usr/bin/env node
// Prints the root CHANGELOG.md section for one version, for use as a
// GitHub Release body: node scripts/release/release-notes.mjs 1.3.0
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Extract the body of a single version's section from CHANGELOG.md.
 * Matches both the bare heading changesets writes (`## 1.3.0`) and the
 * linked heading release-please used for the 21 entries that predate this
 * migration (`## [1.3.0](...) (2026-08-08)`).
 */
export function extractSection(markdown, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(
    `^## \\[?${escaped}\\]?(?:\\([^)]*\\))?.*$`,
    "m"
  );
  const match = headingRe.exec(markdown);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeading = /^## /m.exec(rest);
  const body = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return body.trim();
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: release-notes.mjs <version>");
    process.exit(1);
  }

  const root = path.resolve(fileURLToPath(import.meta.url), "../../..");
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const section = extractSection(changelog, version);

  if (!section) {
    console.error(`No changelog section found for version ${version}`);
    process.exit(1);
  }

  console.log(section);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
