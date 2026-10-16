import { Effect, Queue, Stream } from "effect";
import { Mount } from "foldkit";
import { MeasuredRibbon } from "@/dashboard/message";

/**
 * Reports the ribbon's rendered width on mount and on every resize. A width of
 * zero means the element is hidden at this breakpoint, which says nothing about
 * the ribbon that is showing.
 */
export const MeasureRibbon = Mount.defineStream("MeasureRibbon", {
  messages: [MeasuredRibbon],
  execute: ({ element }) =>
    Stream.callback<typeof MeasuredRibbon.Type>((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new ResizeObserver((entries) => {
              for (const { contentRect } of entries) {
                if (contentRect.width > 0) {
                  Queue.offerUnsafe(
                    queue,
                    MeasuredRibbon({ widthPx: Math.round(contentRect.width) })
                  );
                }
              }
            });
            observer.observe(element);
            return observer;
          }),
          (observer) => Effect.sync(() => observer.disconnect())
        );
        return yield* Effect.never;
      })
    ),
});
