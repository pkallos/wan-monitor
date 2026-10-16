import { Effect, Fiber, Stream } from "effect";
import { afterEach, describe, expect, type Mock, test, vi } from "vitest";
import type { Message } from "@/dashboard/message";
import { MeasureRibbon } from "@/dashboard/ribbonMeasure";

type ObserverCallback = (
  entries: ReadonlyArray<{ contentRect: { width: number } }>
) => void;

const observers: Array<{
  callback: ObserverCallback;
  observed: Array<Element>;
  disconnect: Mock<() => void>;
}> = [];

class FakeResizeObserver {
  readonly state: (typeof observers)[number];

  constructor(callback: ObserverCallback) {
    this.state = { callback, observed: [], disconnect: vi.fn<() => void>() };
    observers.push(this.state);
  }

  observe(element: Element) {
    this.state.observed.push(element);
  }

  disconnect() {
    this.state.disconnect();
  }
}

const widths = (width: number) => [{ contentRect: { width } }];

const startMeasuring = (element: Element) => {
  const received: Array<Message> = [];
  const fiber = Effect.runFork(
    Stream.runForEach(MeasureRibbon().f(element, Stream.empty), (message) =>
      Effect.sync(() => {
        received.push(message);
      })
    )
  );
  return { received, fiber };
};

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("MeasureRibbon", () => {
  test("reports the width the element has now and each one it is resized to", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const element = document.createElement("div");
    const { received, fiber } = startMeasuring(element);
    await vi.waitFor(() => expect(observers).toHaveLength(1));

    observers[0].callback(widths(560.4));
    observers[0].callback(widths(800));
    await vi.waitFor(() => expect(received).toHaveLength(2));

    expect(observers[0].observed).toEqual([element]);
    expect(received).toEqual([
      { _tag: "MeasuredRibbon", widthPx: 560 },
      { _tag: "MeasuredRibbon", widthPx: 800 },
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("ignores a zero width, which an element hidden at this breakpoint reports", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { received, fiber } = startMeasuring(document.createElement("div"));
    await vi.waitFor(() => expect(observers).toHaveLength(1));

    observers[0].callback(widths(0));
    observers[0].callback(widths(640));
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received).toEqual([{ _tag: "MeasuredRibbon", widthPx: 640 }]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("stops observing once the element is torn down", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { fiber } = startMeasuring(document.createElement("div"));
    await vi.waitFor(() => expect(observers).toHaveLength(1));
    expect(observers[0].disconnect).not.toHaveBeenCalled();

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
