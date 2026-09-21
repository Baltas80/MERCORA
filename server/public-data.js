import { spawn } from "node:child_process";

const SITE_KEYS = Object.freeze([
  "site_name",
  "site_mode",
  "announcement",
  "maintenance_message",
  "new_listings_enabled",
  "seller_registration_enabled",
  "footer_notice",
  "hero_title",
  "hero_copy",
  "buy_cta",
  "sell_cta",
  "terms_of_use",
  "privacy_notice",
  "publication_rules"
]);

const MAX_LIMIT = 48;
const MAX_OFFSET = 100000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function publicLimit(value, fallback = 24) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new Error("limit is invalid");
  return n;
}

export function publicOffset(value) {
  const n = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_OFFSET) throw new Error("offset is invalid");
  return n;
}

export function publicSearch(value) {
  const text = String(value ?? "").trim();
  if (text.length > 120) throw new Error("q is too long");
  if (text.includes("\0")) throw new Error("q contains an invalid character");
  return text;
}

export function publicCategory(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.length > 63) throw new Error("category is too long");
  if (text && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(text)) {
    throw new Error("category format is invalid");
  }
  return text;
}

export function publicUuid(value, name = "id") {
  const text = String(value ?? "");
  if (!UUID_RE.test(text)) throw new Error(name + " is not a valid UUID");
  return text;
}

function cleanDiagnostic(text = "") {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/(password|secret|token|private.?key|mnemonic|authorization|database_url)/i.test(line))
    .join("\n")
    .slice(0, 2000);
}

function defaultRunner(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env
    });
    const stdout = [];
    const stderr = [];
    let total = 0;
    const MAX_OUTPUT = 1024 * 1024;

    function collect(target, chunk) {
      total += chunk.length;
      if (total > MAX_OUTPUT) {
        child.kill();
        return;
      }
      target.push(chunk);
    }

    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 256000) stderr.push(chunk);
    });
    child.on("error", (error) => resolve({ ok: false, code: null, stdout: "", stderr: error.message }));
    child.on("close", (code) => resolve({
      ok: code === 0,
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
}

function databaseConnection(databaseUrl) {
  if (!databaseUrl) throw new Error("database is not configured");

  let connection;
  try {
    connection = new URL(databaseUrl);
  } catch {
    throw new Error("database configuration is invalid");
  }

  if (!["postgres:", "postgresql:"].includes(connection.protocol) || !connection.hostname) {
    throw new Error("database configuration is invalid");
  }

  const database = decodeURIComponent(connection.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(connection.username || "");
  if (!database || !username) throw new Error("database configuration is invalid");

  return {
    args: [
      "-X",
      "-q",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "--host",
      connection.hostname,
      "--port",
      connection.port || "5432",
      "--username",
      username,
      "--dbname",
      database
    ],
    env: {
      ...process.env,
      PGAPPNAME: "mercora-public",
      PGPASSWORD: decodeURIComponent(connection.password || "")
    }
  };
}

function parseJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("database returned invalid public JSON");
  }
}

export function createPublicData({
  databaseUrl = process.env.DATABASE_URL,
  runner = defaultRunner
} = {}) {
  async function query(sql, variables = {}) {
    const connection = databaseConnection(databaseUrl);
    const args = [...connection.args];

    for (const [key, value] of Object.entries(variables)) {
      args.push("-v", key + "=" + String(value));
    }

    args.push("-c", sql);

    const result = await runner("psql", args, { env: connection.env });
    if (!result.ok) {
      throw new Error(cleanDiagnostic(result.stderr || result.stdout || "database query failed"));
    }

    return String(result.stdout || "").trim();
  }

  async function json(sql, variables = {}) {
    return parseJson(await query(sql, variables));
  }

  async function siteConfig() {
    const result = await json(
      "SELECT COALESCE(json_object_agg(key,value),'{}'::json)::text FROM site_settings WHERE key = ANY(string_to_array(:'keys',','))",
      { keys: SITE_KEYS.join(",") }
    );
    return result && typeof result === "object" ? result : {};
  }

  async function categories() {
    return json(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.name),'[]'::json)::text " +
      "FROM (SELECT id,slug,name FROM categories WHERE active=true ORDER BY name) x"
    );
  }

  async function listings({ q = "", category = "", limit = 24, offset = 0 } = {}) {
    const search = publicSearch(q);
    const categorySlug = publicCategory(category);
    const take = publicLimit(limit);
    const skip = publicOffset(offset);

    return json(
      `SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text
       FROM (
         SELECT
           l.id,
           l.title,
           l.description,
           l.price_atomic::text AS price_atomic,
           l.price_asset,
           l.condition,
           l.created_at,
           c.slug AS category_slug,
           c.name AS category,
           sp.display_name AS seller,
           COALESCE(sr.verified_sales_count,0)::text AS verified_sales_count,
           sr.rating_average,
           COALESCE(sr.verified_rating_count,0)::text AS verified_rating_count
         FROM listings l
         LEFT JOIN categories c ON c.id=l.category_id
         LEFT JOIN seller_profiles sp ON sp.account_id=l.seller_account_id
         LEFT JOIN seller_reputation sr ON sr.account_id=l.seller_account_id
         WHERE l.status='active'
           AND (
             NULLIF(:'q','') IS NULL
             OR l.title ILIKE '%' || :'q' || '%'
             OR l.description ILIKE '%' || :'q' || '%'
             OR sp.display_name ILIKE '%' || :'q' || '%'
           )
           AND (NULLIF(:'category','') IS NULL OR c.slug=:'category')
         ORDER BY l.created_at DESC
         LIMIT :'limit'::integer
         OFFSET :'offset'::integer
       ) x`,
      {
        q: search,
        category: categorySlug,
        limit: take,
        offset: skip
      }
    );
  }

  async function listing(id) {
    const listingId = publicUuid(id, "listing_id");
    return json(
      `SELECT row_to_json(x)::text
       FROM (
         SELECT
           l.id,
           l.title,
           l.description,
           l.price_atomic::text AS price_atomic,
           l.price_asset,
           l.condition,
           l.created_at,
           l.updated_at,
           c.slug AS category_slug,
           c.name AS category,
           sp.display_name AS seller,
           COALESCE(sr.verified_sales_count,0)::text AS verified_sales_count,
           sr.rating_average,
           COALESCE(sr.verified_rating_count,0)::text AS verified_rating_count
         FROM listings l
         LEFT JOIN categories c ON c.id=l.category_id
         LEFT JOIN seller_profiles sp ON sp.account_id=l.seller_account_id
         LEFT JOIN seller_reputation sr ON sr.account_id=l.seller_account_id
         WHERE l.id=:'id'::uuid
           AND l.status='active'
         LIMIT 1
       ) x`,
      { id: listingId }
    );
  }

  async function seller(displayName) {
    const name = publicSearch(displayName);

    return json(
      `SELECT row_to_json(x)::text
       FROM (
         SELECT
           sp.display_name,
           COALESCE(sr.verified_sales_count,0)::text AS verified_sales_count,
           COALESCE(sr.verified_units_sold,0)::text AS verified_units_sold,
           COALESCE(sr.verified_rating_count,0)::text AS verified_rating_count,
           sr.rating_average,
           (
             SELECT COALESCE(json_agg(row_to_json(lx) ORDER BY lx.created_at DESC),'[]'::json)
             FROM (
               SELECT
                 l.id,
                 l.title,
                 l.price_atomic::text AS price_atomic,
                 l.price_asset,
                 l.condition,
                 c.name AS category,
                 l.created_at
               FROM listings l
               LEFT JOIN categories c ON c.id=l.category_id
               WHERE l.seller_account_id=sp.account_id
                 AND l.status='active'
               ORDER BY l.created_at DESC
               LIMIT 48
             ) lx
           ) AS listings
         FROM seller_profiles sp
         LEFT JOIN seller_reputation sr ON sr.account_id=sp.account_id
         WHERE sp.display_name=:'name'
         LIMIT 1
       ) x`,
      { name }
    );
  }

  return Object.freeze({
    siteConfig,
    categories,
    listings,
    listing,
    seller
  });
}
