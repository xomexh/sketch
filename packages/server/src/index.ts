import { createServer } from "./bootstrap";
import { loadConfig, validateConfig } from "./config";

const config = loadConfig();
validateConfig(config);

const handle = await createServer(config);

process.on("SIGINT", handle.shutdown);
process.on("SIGTERM", handle.shutdown);
