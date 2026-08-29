import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";

import { generatePassword, setLocalPassword } from "../server/auth.js";
import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  resolveDatabasePath,
} from "../server/config.js";
import { openDatabase } from "../server/db.js";
import { users } from "../server/db/schema.js";
import { normalizeUsername } from "../server/identity.js";

const arguments_ = process.argv.slice(2);

if (arguments_.length !== 1) {
  process.stderr.write("Usage: node dist/scripts/set-password.js <username>\n");
  process.exit(1);
}

const username = normalizeUsername(arguments_[0] ?? "");
if (!username) {
  process.stderr.write("The username must not be empty.\n");
  process.exit(1);
}

const input = readFileSync(0, "utf8").replace(/\r?\n$/, "");
const generated = input.length === 0;
const password = generated ? generatePassword() : input;

if (
  password.length < MINIMUM_PASSWORD_LENGTH ||
  password.length > MAXIMUM_PASSWORD_LENGTH
) {
  process.stderr.write(
    `The password must be between ${MINIMUM_PASSWORD_LENGTH} and ${MAXIMUM_PASSWORD_LENGTH} characters.\n`,
  );
  process.exit(1);
}

const database = openDatabase({ databasePath: resolveDatabasePath() });

try {
  const user = database.orm
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (!user) {
    process.stderr.write(`No account named "${username}".\n`);
    process.exitCode = 1;
  } else {
    await setLocalPassword(database, user.id, password, true);
    process.stdout.write(
      generated
        ? `Password for ${username}: ${password}\nIt must be changed at the next sign-in.\n`
        : `Password updated for ${username}. It must be changed at the next sign-in.\n`,
    );
  }
} finally {
  database.close();
}
