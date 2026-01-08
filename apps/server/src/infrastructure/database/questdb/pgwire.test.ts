import { types } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configurePgTypeParsers } from "@/infrastructure/database/questdb/pgwire";

describe("pgwire integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("configurePgTypeParsers", () => {
    it("should configure TIMESTAMP type parser", () => {
      const setTypeParserSpy = vi.spyOn(types, "setTypeParser");

      configurePgTypeParsers();

      expect(setTypeParserSpy).toHaveBeenCalledWith(
        types.builtins.TIMESTAMP,
        expect.any(Function)
      );
    });

    it("should configure TIMESTAMPTZ type parser", () => {
      const setTypeParserSpy = vi.spyOn(types, "setTypeParser");

      configurePgTypeParsers();

      expect(setTypeParserSpy).toHaveBeenCalledWith(
        types.builtins.TIMESTAMPTZ,
        expect.any(Function)
      );
    });

    it("should parse TIMESTAMP value correctly", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      expect(timestampParser).toBeDefined();
      if (timestampParser) {
        const result = timestampParser("2024-01-01 12:00:00");
        expect(result).toBe("2024-01-01T12:00:00Z");
      }
    });

    it("should parse TIMESTAMPTZ value correctly", () => {
      let timestamptzParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMPTZ) {
            timestamptzParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      expect(timestamptzParser).toBeDefined();
      if (timestamptzParser) {
        const result = timestamptzParser("2024-01-01 12:00:00");
        expect(result).toBe("2024-01-01T12:00:00Z");
      }
    });

    it("should handle null TIMESTAMP values", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestampParser) {
        const result = timestampParser("");
        expect(result).toBe("");
      }
    });

    it("should handle null TIMESTAMPTZ values", () => {
      let timestamptzParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMPTZ) {
            timestamptzParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestamptzParser) {
        const result = timestamptzParser("");
        expect(result).toBe("");
      }
    });

    it("should replace space with T in timestamp strings", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestampParser) {
        const result = timestampParser("2024-12-31 23:59:59");
        expect(result).toBe("2024-12-31T23:59:59Z");
        expect(result).not.toContain(" ");
      }
    });

    it("should append Z to parsed timestamps", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestampParser) {
        const result = timestampParser("2024-01-01 12:00:00");
        expect(result).toMatch(/Z$/);
      }
    });

    it("should handle timestamps with milliseconds", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestampParser) {
        const result = timestampParser("2024-01-01 12:00:00.123");
        expect(result).toBe("2024-01-01T12:00:00.123Z");
      }
    });

    it("should handle timestamps with microseconds", () => {
      let timestampParser: ((val: string) => string) | undefined;

      vi.spyOn(types, "setTypeParser").mockImplementation(
        (typeId: unknown, parser: unknown) => {
          if (typeId === types.builtins.TIMESTAMP) {
            timestampParser = parser as (val: string) => string;
          }
        }
      );

      configurePgTypeParsers();

      if (timestampParser) {
        const result = timestampParser("2024-01-01 12:00:00.123456");
        expect(result).toBe("2024-01-01T12:00:00.123456Z");
      }
    });

    it("should be callable multiple times without errors", () => {
      expect(() => {
        configurePgTypeParsers();
        configurePgTypeParsers();
        configurePgTypeParsers();
      }).not.toThrow();
    });
  });
});
