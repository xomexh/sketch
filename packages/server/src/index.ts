import { createServer } from "./bootstrap";
import { loadConfig, validateConfig } from "./config";

const config = loadConfig();
validateConfig(config);

const handle = await createServer(config);

async function shutdown() {
  await handle.shutdown();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
