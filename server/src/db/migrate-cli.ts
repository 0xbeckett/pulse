/**
 * Standalone migration runner: `bun run src/db/migrate-cli.ts`.
 * Opening the SqliteStore applies any pending migrations, so this just does
 * that and reports. Safe to run repeatedly (idempotent).
 */
import { config } from "../config.ts";
import { SqliteStore } from "./sqlite-store.ts";

const store = new SqliteStore(config.dbPath);
console.log(`[migrate] database ready at ${config.dbPath}`);
store.close();
