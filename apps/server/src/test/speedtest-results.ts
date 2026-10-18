import type { SpeedTestExecutor } from "@/infrastructure/speedtest/service";

/** An executor resolving a partial CLI result, as the real CLI does when it cannot take a measurement. */
export const executorYielding = (cliResult: object): SpeedTestExecutor => {
  // @ts-expect-error the CLI result is deliberately partial
  return () => Promise.resolve(cliResult);
};
