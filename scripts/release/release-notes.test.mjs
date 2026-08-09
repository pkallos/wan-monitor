import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSection } from "./release-notes.mjs";

test("extractSection reads a bare changesets version heading", () => {
  const markdown = [
    "# Changelog",
    "",
    "## 1.3.0",
    "",
    "### Minor Changes",
    "",
    "- added thing",
    "",
    "## 1.2.1",
    "",
    "### Patch Changes",
    "",
    "- older thing",
    "",
  ].join("\n");

  assert.equal(
    extractSection(markdown, "1.3.0"),
    "### Minor Changes\n\n- added thing"
  );
});

test("extractSection reads a linked release-please heading", () => {
  const markdown = [
    "# Changelog",
    "",
    "## [1.2.1](https://github.com/pkallos/wan-monitor/compare/wan-monitor-v1.2.0...v1.2.1) (2026-08-04)",
    "",
    "### Bug Fixes",
    "",
    "- a fix",
    "",
  ].join("\n");

  assert.equal(extractSection(markdown, "1.2.1"), "### Bug Fixes\n\n- a fix");
});

test("extractSection returns the trailing section when it is the last one", () => {
  const markdown = "# Changelog\n\n## 1.0.0\n\nfirst release\n";
  assert.equal(extractSection(markdown, "1.0.0"), "first release");
});

test("extractSection returns null when the version has no section", () => {
  const markdown = "# Changelog\n\n## [1.2.0](...) (2026-08-04)\n\nbody\n";
  assert.equal(extractSection(markdown, "9.9.9"), null);
});
