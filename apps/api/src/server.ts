import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectPostgres } from "./db/client.js";

const config = loadConfig();
const { db, migrate, close } = await connectPostgres(config.DATABASE_URL);
await migrate();
const app = await buildApp(db, config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}
await app.listen({ host: "0.0.0.0", port: config.PORT });
