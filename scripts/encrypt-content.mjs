import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createCipheriv, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const blogRoot = path.resolve(scriptRoot, "..");
const outputPath = path.resolve(process.argv[2] ?? path.join(blogRoot, "automation", "content.enc"));
const key = Buffer.from(process.env.CONTENT_KEY_B64 ?? "", "base64");

if (key.length !== 32) {
  throw new Error("CONTENT_KEY_B64 debe contener exactamente 32 bytes codificados en base64.");
}

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(blogRoot, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "es"))) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const includedPaths = ["blog.json", ...await walk("posts")];
const files = [];
for (const relativePath of includedPaths) {
  let content = await fs.readFile(path.join(blogRoot, ...relativePath.split("/")));
  if (relativePath === "blog.json") {
    const source = JSON.parse(content.toString("utf8"));
    const buildConfig = {
      title: source.title,
      url: source.url,
      description: source.description,
      purpose: source.purpose,
      timezone: source.timezone,
      identity: source.identity,
      visual_identity: source.visual_identity,
      static_site: source.static_site,
      content_plan: source.content_plan
    };
    content = Buffer.from(JSON.stringify(buildConfig), "utf8");
  }
  files.push({ path: relativePath, content: content.toString("base64") });
}

const manifest = Buffer.from(JSON.stringify({ version: 1, files }), "utf8");
const compressed = gzipSync(manifest, { level: 9 });
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
const tag = cipher.getAuthTag();
const payload = Buffer.concat([Buffer.from("DAB1"), iv, tag, encrypted]);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, payload);
console.log(JSON.stringify({ encrypted_files: files.length, encrypted_bytes: payload.length }));
