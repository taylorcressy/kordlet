import SQLite from "better-sqlite3";
import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalDirectory } from "./paths";
export async function maintain(action: "backup" | "restore", file: string) {
  const directory = canonicalDirectory();
  const database = join(directory, "workspace.sqlite");
  const lock = new SQLite(join(directory, "ownership.sqlite"), { timeout: 0 });
  try {
    lock.exec("BEGIN EXCLUSIVE");
    const source = action === "backup" ? database : file;
    const destination = action === "backup" ? file : database;
    if (!existsSync(source) || source === destination)
      throw Error("Select a distinct, existing source database.");
    if (action === "backup" && existsSync(destination))
      throw Error("Backup destination already exists.");
    const db = new SQLite(source, { readonly: true, fileMustExist: true });
    const temp = destination + "." + randomUUID() + ".tmp";
    try {
      if (
        db.pragma("quick_check", { simple: true }) !== "ok" ||
        db.pragma("user_version", { simple: true }) !== 1
      )
        throw Error("Backup database is damaged or its schema is unsupported.");
      await db.backup(temp);
      if (action === "restore" && existsSync(database)) {
        const previous = new SQLite(database, { fileMustExist: true });
        try {
          const result = previous.pragma("wal_checkpoint(TRUNCATE)") as {
            busy: number;
          }[];
          if (result.some((x) => x.busy)) throw Error("Database is busy.");
        } finally {
          previous.close();
        }
      }
      renameSync(temp, destination);
    } finally {
      db.close();
      rmSync(temp, { force: true });
    }
    return { action, file: destination };
  } finally {
    lock.close();
  }
}
