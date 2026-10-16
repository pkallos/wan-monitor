import { expect, type Locator, test } from "@playwright/test";

const QUICK_RANGES = ["1h", "24h", "7d", "30d"] as const;

// lg breakpoint and up is where the controls sit on a single right-aligned row.
test.use({ viewport: { width: 1280, height: 800 } });

const boxX = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("control has no bounding box");
  }
  return box.x;
};

// WCAG relative luminance contrast between two [r, g, b] colors.
const contrastRatio = (a: number[], b: number[]): number => {
  const luminance = (channels: number[]): number => {
    const [r = 0, g = 0, bl = 0] = channels.map((channel) => {
      const unit = channel / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

test.describe("header controls", () => {
  test("controls keep their position when the quick range changes", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    const quickRange = page.getByRole("group", { name: "Quick range" });
    const pickerTrigger = page.locator("#date-range-picker-button");
    const controls = {
      quickRange,
      refresh: page.getByRole("button", { name: "Refresh now" }),
      pause: page.getByRole("button", { name: /^(Pause|Resume)/ }),
      menu: page.getByRole("button", { name: "Menu" }),
    };
    const positions = async (): Promise<Record<string, number>> => ({
      quickRange: await boxX(controls.quickRange),
      refresh: await boxX(controls.refresh),
      pause: await boxX(controls.pause),
      menu: await boxX(controls.menu),
    });

    const initial = await positions();
    const labels = new Set<string>([(await pickerTrigger.textContent()) ?? ""]);

    for (const name of QUICK_RANGES) {
      await quickRange.getByRole("button", { name, exact: true }).click();
      await expect(
        quickRange.getByRole("button", { name, exact: true })
      ).toHaveAttribute("aria-pressed", "true");
      labels.add((await pickerTrigger.textContent()) ?? "");

      expect(await positions(), `after selecting ${name}`).toEqual(initial);
    }

    // Guards against the test passing only because the label never changed.
    expect(labels.size).toBeGreaterThan(1);
  });

  test("tab order follows the left-to-right reading order of the controls", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Refresh now" })).toBeEnabled(
      { timeout: 10_000 }
    );

    const focusedControl = (): Promise<string> =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) {
          return "";
        }
        if (el.id === "date-range-picker-button") {
          return "date picker";
        }
        return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
      });

    const visited: string[] = [];
    let control = "";
    while (control !== "Menu" && visited.length < 20) {
      await page.keyboard.press("Tab");
      control = await focusedControl();
      visited.push(control);
    }

    expect(visited).toEqual([
      "1h",
      "24h",
      "7d",
      "30d",
      "date picker",
      "Refresh now",
      "Pause",
      "Menu",
    ]);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the keyboard-active menu item stands out from the menu in ${colorScheme} mode`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("menu")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.locator('[role="menuitem"][data-active]')).toHaveCount(
        1
      );

      const { ring, background, menuLayers } = await page.evaluate(() => {
        const context = document.createElement("canvas").getContext("2d", {
          willReadFrequently: true,
        });
        if (context === null) {
          throw new Error("no 2d canvas context");
        }
        const toRgba = (css: string): number[] => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = "rgba(0, 0, 0, 0)";
          context.fillStyle = css;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const item = document.querySelector('[role="menuitem"][data-active]');
        const menu = document.querySelector('[role="menu"]');
        if (item === null || menu === null) {
          throw new Error("no active menu item");
        }
        const menuLayers: number[][] = [];
        for (
          let el: Element | null = menu;
          el !== null;
          el = el.parentElement
        ) {
          menuLayers.push(toRgba(getComputedStyle(el).backgroundColor));
        }
        const itemStyle = getComputedStyle(item);
        const colorFunction =
          /(?:rgba?|oklab|oklch|lab|lch|hsla?|hwb|color)\([^)]*\)/;
        const ringLayer = itemStyle.boxShadow
          .split(/,(?![^(]*\))/)
          .flatMap((layer) => {
            const color = layer.match(colorFunction)?.[0];
            const lengths = layer
              .replace(colorFunction, "")
              .match(/-?\d*\.?\d+px/g);
            const spread = Number.parseFloat(lengths?.[3] ?? "0");
            return color !== undefined && spread > 0 ? [toRgba(color)] : [];
          })
          .find(([, , , alpha = 0]) => alpha > 0);
        return {
          ring: ringLayer ?? null,
          background: toRgba(itemStyle.backgroundColor),
          menuLayers,
        };
      });

      const compositeOver = (layer: number[], below: number[]): number[] => {
        const [r = 0, g = 0, b = 0, alpha = 0] = layer;
        return [r, g, b].map(
          (channel, index) =>
            (alpha / 255) * channel + (1 - alpha / 255) * (below[index] ?? 0)
        );
      };
      const isVisible = ([, , , alpha = 0]: number[]): boolean => alpha > 0;
      const surface = menuLayers.reduceRight(
        (below, layer) => compositeOver(layer, below),
        [255, 255, 255]
      );
      const indicatorLayer =
        ring ?? (isVisible(background) ? background : null);
      if (indicatorLayer === null) {
        throw new Error(
          "active menu item has neither a visible ring nor a background"
        );
      }

      expect(
        contrastRatio(compositeOver(indicatorLayer, surface), surface)
      ).toBeGreaterThanOrEqual(3);
    });
  }
});
