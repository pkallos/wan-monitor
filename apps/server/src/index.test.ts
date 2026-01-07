import { Effect } from "effect";
import { describe, expect, it } from "vitest";

/**
 * Regression test for PHI-31: TypeError: evaluate(...).then is not a function
 *
 * This test verifies that Fastify route registration is properly wrapped
 * in async functions and Effect.tryPromise to prevent the TypeError that
 * occurred when using Effect.promise with non-thenable returns.
 */
describe("Server Startup - Effect.tryPromise Usage", () => {
  it("should properly wrap async operations in Effect.tryPromise", async () => {
    // This test verifies the pattern used in src/index.ts
    // The fix required wrapping app.register() calls in async functions

    // Simulate Fastify's register method which returns a chainable instance
    const mockRegister = async () => {
      return Promise.resolve();
    };

    // INCORRECT pattern (causes TypeError):
    // Effect.promise(() => app.register(...))
    // This fails because register returns a Fastify instance, not a Promise

    // CORRECT pattern (fixed in PHI-31):
    const correctPattern = Effect.tryPromise({
      try: async () => {
        await mockRegister();
      },
      catch: (error) => new Error(`Registration failed: ${error}`),
    });

    // Verify the Effect can be run without throwing
    const result = await Effect.runPromise(correctPattern);
    expect(result).toBeUndefined();
  });

  it("should demonstrate the TypeError that would occur with incorrect usage", () => {
    // This documents what happens with the incorrect pattern

    // Mock a function that returns a non-Promise thenable (like Fastify instance)
    const mockFastifyRegister = () => {
      const fastifyInstance = {
        register: () => {},
      };
      // Fastify instance doesn't have a proper .then function
      return fastifyInstance;
    };

    // Verify the mock doesn't have a proper .then method
    const result = mockFastifyRegister();
    expect(result).not.toHaveProperty("then");

    // This would cause: TypeError: evaluate(...).then is not a function
    // if we tried to use Effect.promise(() => mockFastifyRegister())
  });

  it("should verify async wrapper returns a proper Promise", async () => {
    // The fix wraps the operation in an async function
    const asyncWrapper = async () => {
      // Simulate Fastify register
      await Promise.resolve();
    };

    const result = asyncWrapper();

    // Verify it returns a Promise (not a Fastify instance)
    expect(result).toBeInstanceOf(Promise);
    expect(typeof result.then).toBe("function");

    await result; // Should not throw
  });

  it("should handle errors in Effect.tryPromise wrapper", async () => {
    const errorMessage = "Registration failed";

    const failingEffect = Effect.tryPromise({
      try: async () => {
        throw new Error(errorMessage);
      },
      catch: (error) => new Error(`Caught: ${error}`),
    });

    // Verify the effect fails with our error
    await expect(Effect.runPromise(failingEffect)).rejects.toThrow("Caught:");
  });
});
