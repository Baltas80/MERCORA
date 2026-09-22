import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function localPath(value) {
  const clean = value.split("#", 1)[0].split("?", 1)[0];
  if (!clean || /^(?:https?:)?\/\//i.test(clean) || clean.startsWith("data:") || clean.startsWith("#")) return null;
  return clean.replace(/^\.\//, "");
}

async function assertHtmlResources(htmlFile) {
  const html = await fs.readFile(path.join(ROOT, htmlFile), "utf8");
  const refs = [
    ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1])
  ];
  for (const ref of refs) {
    const local = localPath(ref);
    if (!local) continue;
    const target = path.resolve(ROOT, local);
    assert.ok(target.startsWith(ROOT + path.sep), `resource escapes web root: ${ref}`);
    await fs.access(target);
  }
}

test("public HTML references only existing local script and stylesheet resources", async () => {
  for (const file of ["index.html", "account.html", "listing.html", "legal.html", "sell.html", "seller.html"]) {
    await assertHtmlResources(file);
  }
});

test("public app static imports resolve to files", async () => {
  const source = await fs.readFile(path.join(ROOT, "web", "app.js"), "utf8");
  for (const match of source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
    const target = path.resolve(ROOT, "web", match[1]);
    assert.ok(target.startsWith(path.resolve(ROOT, "web") + path.sep));
    await fs.access(target);
  }
});

test("public checkout helper preserves POST request options", async () => {
  const source = await fs.readFile(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(source, /async function api\(path, options = \{\}\)/);
  assert.match(source, /\.\.\.options/);
  assert.match(source, /fetch\(path, \{/);
  assert.match(source, /state\.cart\.map\(item => \(\{ listing_id: item\.id, quantity: 1 \}\)\)/);
});
