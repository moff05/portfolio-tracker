import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const token = process.env.GH_UPDATE_TOKEN ?? "";

const out = join(__dirname, "..", "electron", "update-token.generated.mjs");
writeFileSync(out, `export const GH_UPDATE_TOKEN = ${JSON.stringify(token)};\n`);

console.log(`[inject-update-token] wrote ${out} (token ${token ? "present" : "empty"})`);
