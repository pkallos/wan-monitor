import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";

export const ledgerName = (table: string): string => `${table}_migrations`;

/**
 * Records `migration` as applied without running it. The runner uses this same
 * statement to record a success, so the printed remedies always match the
 * ledger format.
 */
export const acceptAsAppliedSql = (
  ledger: string,
  migration: Pick<Migration, "version" | "name">
): string =>
  `INSERT INTO ${ledger} VALUES (${migration.version}, '${migration.name}', now())`;
