import app from "./app";
import { logger } from "./lib/logger";
import { initReady, statsReady } from "./routes/proxy";
import { settingsReady } from "./routes/settings";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

Promise.all([initReady, statsReady, settingsReady]).then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}).catch((err) => {
  logger.error({ err }, "Failed to initialise persisted data");
  process.exit(1);
});
