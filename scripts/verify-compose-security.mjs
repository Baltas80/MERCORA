import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");

const must = [
  ["postgres service exists", /\n  postgres:\n/.test(compose)],
  ["postgres publishes no host ports", !/postgres:[\s\S]*?ports:/m.test(compose)],
  ["migrate publishes no host ports", !/migrate:[\s\S]*?ports:/m.test(compose)],
  ["api publishes no host ports", !/api:[\s\S]*?ports:/m.test(compose)],
  ["worker publishes no host ports", !/worker:[\s\S]*?ports:/m.test(compose)],
  ["only proxy publishes loopback 8080", (compose.match(/ports:/g) || []).length === 1 && /proxy:[\s\S]*?127\\.0\\.0\\.1:8080:80/.test(compose)],
  ["postgres uses data network only", /postgres:[\s\S]*?networks: \[data\]/m.test(compose)],
  ["migrate uses data network only", /migrate:[\s\S]*?networks: \[data\]/m.test(compose)],
  ["worker uses data network only", /worker:[\s\S]*?networks: \[data\]/m.test(compose)],
  ["api is the only frontend/data bridge", /api:[\s\S]*?networks: \[frontend,data\]/m.test(compose)],
  ["proxy uses frontend network only", /proxy:[\s\S]*?networks: \[frontend\]/m.test(compose)],
  ["frontend network is internal", /frontend:\s*\n\s*internal: true/.test(compose)],
  ["data network is internal", /data:\s*\n\s*internal: true/.test(compose)],
  ["public host is mandatory", /MERCORA_PUBLIC_HOST: \$\{MERCORA_PUBLIC_HOST:\?set MERCORA_PUBLIC_HOST\}/.test(compose)],
  ["api is read-only", /api:[\s\S]*?read_only: true/.test(compose)],
  ["api drops all capabilities", /api:[\s\S]*?cap_drop: \[ALL\]/.test(compose)],
  ["proxy drops all capabilities", /proxy:[\s\S]*?cap_drop: \[ALL\]/.test(compose)],
  ["postgres has no sensitive host bind", !/postgres:[\s\S]*?\.:/.test(compose)]
];

const failed = must.filter((entry) => !entry[1]).map((entry) => entry[0]);
if (failed.length) {
  console.error("Compose security verification failed:");
  for (const item of failed) console.error("- " + item);
  process.exit(1);
}
console.log("Compose security verification passed.");
