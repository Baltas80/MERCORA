import { readFile } from "node:fs/promises";

const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
const normalized = "\n" + compose;
function serviceBlock(name) {
  const marker = "\n  " + name + ":\n";
  const start = normalized.indexOf(marker);
  if (start < 0) return "";
  const after = start + marker.length;
  const next = normalized.slice(after).search(/\n  [A-Za-z0-9_-]+:\n|\nnetworks:\n/);
  return next < 0 ? normalized.slice(after) : normalized.slice(after, after + next);
}
const postgres = serviceBlock("postgres");
const migrate = serviceBlock("migrate");
const api = serviceBlock("api");
const worker = serviceBlock("worker");
const proxy = serviceBlock("proxy");

const must = [
  ["postgres service exists", postgres.length > 0],
  ["postgres publishes no host ports", !/^\\s+ports:/m.test(postgres)],
  ["migrate publishes no host ports", !/^\\s+ports:/m.test(migrate)],
  ["api publishes no host ports", !/^\\s+ports:/m.test(api)],
  ["worker publishes no host ports", !/^\\s+ports:/m.test(worker)],
  ["proxy is the only published service", /^\\s+ports:/m.test(proxy) && (compose.match(/(^|\\n)\\s+ports:/g) || []).length === 1],
  ["proxy publishes only loopback 8080", /127\\.0\\.0\\.1:8080:8080/.test(proxy)],
  ["postgres uses data network only", /networks: \[data\]/.test(postgres)],
  ["migrate uses data network only", /networks: \[data\]/.test(migrate)],
  ["worker uses data network only", /networks: \[data\]/.test(worker)],
  ["api bridges frontend and data", /networks: \[frontend,data\]/.test(api)],
  ["proxy uses frontend only", /networks: \[frontend\]/.test(proxy)],
  ["frontend network is internal", /frontend:\s*\n\s*internal: true/.test(compose)],
  ["data network is internal", /data:\s*\n\s*internal: true/.test(compose)],
  ["proxy requires public host environment", /MERCORA_PUBLIC_HOST:\s*\$\{MERCORA_PUBLIC_HOST:\?set MERCORA_PUBLIC_HOST\}/.test(proxy)],
  ["api is read-only", /read_only: true/.test(api)],
  ["api drops all capabilities", /cap_drop: \[ALL\]/.test(api)],
  ["no tor private material is mounted", !/(tor\\/keys|PRIVATE KEY|mnemonic|seed phrase)/i.test(compose)]
];

const failed = must.filter((entry) => !entry[1]).map((entry) => entry[0]);
if (failed.length) {
  console.error("Compose security verification failed:");
  for (const item of failed) console.error("- " + item);
  process.exit(1);
}
console.log("Compose security verification passed.");
