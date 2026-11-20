// Writes openapi.json: the contract the Node/Python/PHP/Java packages and the CLI are built against.
import { writeFileSync } from "node:fs";
import { buildApp } from "../build-app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db/client.js";

const app = await buildApp({} as Db, loadConfig({ NODE_ENV: "test" }));
await app.ready();
writeFileSync("openapi.json", JSON.stringify(app.swagger(), null, 2) + "\n");
console.log("Wrote openapi.json");
await app.close();
