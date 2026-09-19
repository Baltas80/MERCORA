import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const compose = await readFile(new URL("docker-compose.yml", root), "utf8");
const nginx = await readFile(new URL("infra/nginx/default.conf.template", root), "utf8");
const torrc = await readFile(new URL("tor/torrc.example", root), "utf8");

const must = [
  ["postgres uses only data network", /postgres:[\s\S]*?networks:\s*\[data\]/m.test(compose)],
  ["migrate uses only data network", /migrate:[\s\S]*?networks:\s*\[data\]/m.test(compose)],
  ["worker uses only data network", /worker:[\s\S]*?networks:\s*\[data\]/m.test(compose)],
  ["api bridges frontend and data networks", /api:[\s\S]*?networks:\s*\[frontend,data\]/m.test(compose)],
  ["proxy uses only frontend network", /proxy:[\s\S]*?networks:\s*\[frontend\]/m.test(compose)],
  ["only proxy publishes host port 8080", (compose.match(/ports:/g) || []).length === 1 && /proxy:[\s\S]*?127\.0\.0\.1:8080:80/.test(compose)],
  ["frontend network is internal", /frontend:\s*\n\s*internal:\s*true/.test(compose)],
  ["data network is internal", /data:\s*\n\s*internal:\s*true/.test(compose)],
  ["proxy canonical host comes from required environment", /MERCORA_PUBLIC_HOST:\s*\$\{MERCORA_PUBLIC_HOST:\?set MERCORA_PUBLIC_HOST\}/.test(compose)],
  ["nginx has a fail-closed default host", /listen 80 default_server;\s*\n\s*server_name \"\";\s*\n\s*return 421;/.test(nginx)],
  ["nginx disables version disclosure", /server_tokens off;/.test(nginx)],
  ["nginx does not forward client IP headers", /proxy_set_header X-Forwarded-For \"\";[\s\S]*?proxy_set_header X-Real-IP \"\";/.test(nginx)],
  ["tor is explicitly Onion Service v3", /HiddenServiceVersion 3/.test(torrc)],
  ["tor control/socks interfaces are disabled", /SocksPort 0/.test(torrc) && /ControlPort 0/.test(torrc)],
  ["tor config contains no private-key material", !/(PRIVATE KEY|private_key|x25519 private|mnemonic|seed phrase)/i.test(torrc)]
];

const failed = must.filter((entry) => !entry[1]).map((entry) => entry[0]);
if (failed.length) {
  console.error("Edge security verification failed:");
  for (const item of failed) console.error("- " + item);
  process.exit(1);
}
console.log("Edge security verification passed.");
