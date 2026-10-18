import { describe, expect, it, vi } from "vitest";

const { runSpeedTest, makeCancel } = vi.hoisted(() => ({
  runSpeedTest: vi.fn(() => new Promise<never>(() => {})),
  makeCancel: vi.fn(),
}));

vi.mock("speedtest-net", () => ({
  default: Object.assign(runSpeedTest, { makeCancel }),
}));

import { liveExecutor } from "@/infrastructure/speedtest/service";

describe("liveExecutor", () => {
  it("hands the CLI a canceler that fires when the signal aborts", () => {
    const cancel = vi.fn();
    makeCancel.mockReturnValue(cancel);
    const controller = new AbortController();

    void liveExecutor(controller.signal);

    expect(runSpeedTest).toHaveBeenCalledWith(
      expect.objectContaining({ cancel, acceptLicense: true, acceptGdpr: true })
    );
    expect(cancel).not.toHaveBeenCalled();

    controller.abort();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("makes one canceler per run, so a cancelled run cannot cancel the next", () => {
    const first = vi.fn();
    const second = vi.fn();
    makeCancel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const firstRun = new AbortController();

    void liveExecutor(firstRun.signal);
    void liveExecutor(new AbortController().signal);
    firstRun.abort();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
