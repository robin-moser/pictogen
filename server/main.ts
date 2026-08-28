import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";
import { openDatabase } from "./db.js";

async function start() {
  const config = parseConfig();
  const database = openDatabase({ databasePath: config.databasePath });
  let app: Awaited<ReturnType<typeof buildApp>>;

  try {
    app = await buildApp({ config, database });
    app.generationWorker.start();
  } catch (error) {
    database.close();
    throw error;
  }

  let closing = false;

  async function shutdown(signal: NodeJS.Signals) {
    if (closing) {
      return;
    }

    closing = true;
    app.log.info({ signal }, "Shutting down");
    await app.close();
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exitCode = 1;
  }
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
});
