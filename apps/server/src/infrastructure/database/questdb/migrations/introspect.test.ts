import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { awaitApplied } from "@/infrastructure/database/questdb/migrations/introspect";
import { createFakeContext } from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

describe("awaitApplied", () => {
  it.effect(
    "keeps polling while writerTxn is below sequencerTxn, comparing them as numbers",
    () => {
      let reads = 0;
      const { ctx } = createFakeContext({
        table: "metrics",
        wal: {
          metrics: () => {
            reads += 1;
            return reads < 3
              ? { suspended: false, writerTxn: 99, sequencerTxn: 100 }
              : { suspended: false, writerTxn: 100, sequencerTxn: 100 };
          },
        },
      });

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(awaitApplied(ctx, "metrics"));
        yield* TestClock.adjust(Duration.seconds(5));
        const status = yield* Fiber.join(fiber);

        expect(reads).toBe(3);
        expect(status).toEqual({
          suspended: false,
          writerTxn: 100,
          sequencerTxn: 100,
        });
      });
    }
  );

  it.effect("returns undefined for a table that is not a WAL table", () => {
    const { ctx } = createFakeContext({ table: "metrics" });

    return Effect.gen(function* () {
      expect(yield* awaitApplied(ctx, "metrics")).toBeUndefined();
    });
  });

  it.effect("refuses a suspended table with the default advice", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      wal: { metrics: { suspended: true, writerTxn: 4, sequencerTxn: 5 } },
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(awaitApplied(ctx, "metrics"));

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("ALTER TABLE metrics RESUME WAL");
    });
  });

  it.effect("refuses a suspended table with the caller's own message", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      wal: { metrics: { suspended: true, writerTxn: 4, sequencerTxn: 5 } },
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        awaitApplied(ctx, "metrics", (unapplied) => `${unapplied} stuck`)
      );

      expect(error.kind).toBe("terminal");
      expect(error.message).toBe("1 stuck");
    });
  });
});
