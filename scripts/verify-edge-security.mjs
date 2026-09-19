import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const compose = await readFile(new URL("docker-compose.yml", root), "utf8");
const nginx = await readFile(new URL("infra/nginx/default.conf.template", root), "utf8");
const torrc = await readFile(new URL("tor/torrc.example", root), "utf8");

const must = [
  ["proxy publishes loopback 8080", /127\.0\.0\.1:8080:8080/.test(compose)],
  ["nginx listens on non-privileged 8080", /listen 8080 default_server;/.test(nginx) && /listen 8080;/.test(nginx)],
  ["nginx has fail-closed default host", /listen 8080 default_server;\s*\n\s*server_name "";\s*\n\s*return 421;/.test(nginx)],
  ["nginx references configured public host", /server_name \$\{MERCORA_PUBLIC_HOST\};/.test(nginx)],
  ["nginx envsubst is restricted", /NGINX_ENVSUBST_FILTER: \^MERCORA_PUBLIC_HOST\$/.test(compose)],
  ["nginx routes dynamic requests to api", /try_files \$uri \$uri\/ @api;/.test(nginx) && /location @api/.test(nginx) && /proxy_pass http:\/\/api:8000;/.test(nginx)],
  ["nginx does not forward client IP", /proxy_set_header X-Forwarded-For "";[\s\S]*?proxy_set_header X-Real-IP "";/.test(nginx)],
  ["nginx disables version disclosure", /server_tokens off;/.test(nginx)],
  ["nginx same-origin CSP", /connect-src 'self'/.test(nginx)],
  ["tor is explicitly v3", /HiddenServiceVersion 3/.test(torrc)],
  ["tor has no SOCKS or control listener", /SocksPort 0/.test(torrc) && /ControlPort 0/.test(torrc)],
  ["tor targets loopback edge", /HiddenServicePort 80 127\.0\.0\.1:8080/.test(torrc)],
  ["tor template contains no private key material", !/(PRIVATE KEY|private_key|x25519 private|mnemonic|seed phrase)/i.test(torrc)]
];

const failed = must.filter((entry) => !entry[1]).map((entry) => entry[0]);
if (failed.length) {
  console.error("Edge security verification failed:");
  for (const item of failed) console.error("- " + item);
  process.exit(1);
}
console.log("Edge security verification passed.");
