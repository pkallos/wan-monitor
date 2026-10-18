import { TriggerPingResponse } from "@shared/api/routes/ping";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("TriggerPingResponse", () => {
  const encode = Schema.encodeSync(TriggerPingResponse);

  it("keeps the write error of a host whose row could not be stored", () => {
    const response = encode({
      success: true,
      timestamp: "2024-02-10T08:00:00.000Z",
      results: [
        { host: "8.8.8.8", success: true, writeError: "DB unavailable" },
        { host: "1.1.1.1", success: false, error: "PingTimeoutError" },
      ],
    });

    expect(response.results).toEqual([
      { host: "8.8.8.8", success: true, writeError: "DB unavailable" },
      { host: "1.1.1.1", success: false, error: "PingTimeoutError" },
    ]);
  });
});
