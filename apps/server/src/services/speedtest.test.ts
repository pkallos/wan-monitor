import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const isMacArm64 = process.platform === "darwin" && process.arch === "arm64";

describe.skipIf(!isMacArm64)("SpeedTest - speedtest-net ARM64 patch", () => {
  it("should have darwin arm64 platform support in speedtest-net", () => {
    const speedtestIndexPath = path.join(
      __dirname,
      "../../../../node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net/index.js"
    );

    if (!fs.existsSync(speedtestIndexPath)) {
      throw new Error(
        `speedtest-net not found at ${speedtestIndexPath}. Run pnpm install first.`
      );
    }

    const content = fs.readFileSync(speedtestIndexPath, "utf-8");

    // Check for darwin arm64 platform entry
    const hasDarwinArm64 =
      content.includes("platform: 'darwin'") &&
      content.includes("arch: 'arm64'");

    expect(hasDarwinArm64).toBe(true);

    // Verify the patch structure - should have both darwin arm64 and darwin x64
    const darwinArm64Match = content.match(
      /{\s*(?:defaultVersion:\s*'[\d.]+',\s*)?platform:\s*'darwin',\s*arch:\s*'arm64'/
    );
    const darwinX64Match = content.match(
      /{\s*(?:defaultVersion:\s*'[\d.]+',\s*)?platform:\s*'darwin',\s*arch:\s*'x64'/
    );

    expect(darwinArm64Match).toBeTruthy();
    expect(darwinX64Match).toBeTruthy();
  });

  it("should have correct binary information for darwin arm64", () => {
    const speedtestIndexPath = path.join(
      __dirname,
      "../../../../node_modules/.pnpm/speedtest-net@2.2.0/node_modules/speedtest-net/index.js"
    );

    const content = fs.readFileSync(speedtestIndexPath, "utf-8");

    // Verify darwin arm64 entry has proper binary info
    const platformsSection = content.match(/const platforms = \[([\s\S]+?)\];/);
    expect(platformsSection).toBeTruthy();

    if (platformsSection) {
      const platforms = platformsSection[1];

      // Should have darwin arm64 with macosx package
      expect(platforms).toContain("platform: 'darwin'");
      expect(platforms).toContain("arch: 'arm64'");
      expect(platforms).toContain("pkg: 'macosx-universal");

      // Verify darwin arm64 entry exists with correct structure
      const darwinArm64Section = platforms.match(
        /platform:\s*'darwin',\s*arch:\s*'arm64'/
      );
      expect(darwinArm64Section).toBeTruthy();
    }
  });
});
