#!/usr/bin/env node

/**
 * Check that the current Node.js version meets the minimum requirement.
 * This script is run as a preinstall hook to fail fast if the wrong version is used.
 *
 * Note: This script cannot auto-switch Node versions because it runs in a subprocess.
 * For automatic switching, add nvm auto-use to your shell config (see README).
 */

const REQUIRED_MAJOR = 24;
const current = process.versions.node;
const [curMajor] = current.split('.');

if (parseInt(curMajor, 10) < REQUIRED_MAJOR) {
  // Check if nvm is available and the required version is installed
  let nvmAvailable = false;
  let requiredVersionInstalled = false;

  try {
    // Check if .nvmrc exists and nvm has the version
    const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`;
    const fs = require('node:fs');
    if (fs.existsSync(nvmDir)) {
      nvmAvailable = true;
      // Check if node 24 is installed in nvm
      const nodeVersionsDir = `${nvmDir}/versions/node`;
      if (fs.existsSync(nodeVersionsDir)) {
        const versions = fs.readdirSync(nodeVersionsDir);
        requiredVersionInstalled = versions.some((v) =>
          v.startsWith(`v${REQUIRED_MAJOR}`)
        );
      }
    }
  } catch {
    // Ignore errors checking nvm
  }

  console.error('\x1b[31m');
  console.error(
    '╔════════════════════════════════════════════════════════════╗'
  );
  console.error(
    '║                    NODE VERSION ERROR                       ║'
  );
  console.error(
    '╠════════════════════════════════════════════════════════════╣'
  );
  console.error(
    `║  Required: Node ${REQUIRED_MAJOR}+                                        ║`
  );
  console.error(`║  Current:  Node ${current.padEnd(41)}║`);
  console.error(
    '╠════════════════════════════════════════════════════════════╣'
  );

  if (nvmAvailable && requiredVersionInstalled) {
    console.error(
      '║  To fix:   nvm use                                         ║'
    );
  } else if (nvmAvailable) {
    console.error(
      '║  To fix:   nvm install 24 && nvm use                       ║'
    );
  } else {
    console.error(
      '║  To fix:   Install Node 24+ from https://nodejs.org        ║'
    );
  }

  console.error(
    '╚════════════════════════════════════════════════════════════╝'
  );
  console.error('\x1b[0m');

  // Provide a tip about auto-switching
  console.error(
    '\x1b[33mTip: Add nvm auto-use to your shell for automatic switching.\x1b[0m'
  );
  console.error(
    'See: https://github.com/nvm-sh/nvm#deeper-shell-integration\n'
  );

  process.exit(1);
}
