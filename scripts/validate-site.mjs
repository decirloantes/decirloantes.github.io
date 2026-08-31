import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(root, "site");
const blog = JSON.parse(await fs.readFile(path.join(root, "blog.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(root, "image-manifest.json"), "utf8"));
const errors = [];
const requiredMeta = [
  "title",
  "slug",
  "status",
  "created_at",
  "published_at",
  "author",
  "categories",
  "tags",
  "summary",
  "canonical_url",
  "featured_image",
  "image_alt",
];

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("[") && value.endsWith("]"))
  ) return JSON.parse(value);
  return value;
}

function parseDocument(raw, label) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) {
    errors.push(`${label}: front matter ausente o inválido`);
    return { meta: {}, body: raw };
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (field) meta[field[1]] = parseScalar(field[2]);
  }
  return { meta, body: match[2].trim() };
}

function wordCount(text) {
  const plain = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`\[\]()>|]/g, " ");
  return plain.match(/\b[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*\b/gu)?.length ?? 0;
}

function normalized(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function walk(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute));
    else output.push(absolute);
  }
  return output;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const posts = [];
for (let number = 1; number <= 30; number += 1) {
  const directory = path.join(root, "posts", String(number));
  const names = await fs.readdir(directory);
  const markdownNames = names.filter(name => name.toLowerCase().endsWith(".md"));
  const jpegNames = names.filter(name => /\.jpe?g$/i.test(name));
  if (markdownNames.length !== 1) errors.push(`posts/${number}: se esperaba un Markdown y hay ${markdownNames.length}`);
  if (jpegNames.length !== 1) errors.push(`posts/${number}: se esperaba un JPG y hay ${jpegNames.length}`);
  const raw = await fs.readFile(path.join(directory, markdownNames[0]), "utf8");
  const parsed = parseDocument(raw, `posts/${number}`);
  for (const field of requiredMeta) {
    if (parsed.meta[field] === undefined || parsed.meta[field] === "") {
      errors.push(`posts/${number}: falta el metadato ${field}`);
    }
  }
  const words = wordCount(parsed.body);
  if (words < 700) errors.push(`posts/${number}: solo ${words} palabras de cuerpo`);
  const leadingH1 = /^#\s+/m.test(parsed.body);
  if (leadingH1) errors.push(`posts/${number}: conserva un H1 Markdown en el cuerpo`);
  const expectedCanonical = new URL(`/posts/${parsed.meta.slug}/`, blog.url).href;
  if (parsed.meta.canonical_url !== expectedCanonical) {
    errors.push(`posts/${number}: canonical_url no coincide con el slug`);
  }
  if (parsed.meta.featured_image !== jpegNames[0]) {
    errors.push(`posts/${number}: featured_image no coincide con el JPG`);
  }
  const registryPost = blog.posts.find(post => post.number === number);
  if (!registryPost) {
    errors.push(`posts/${number}: falta en blog.json`);
  } else {
    if (registryPost.title !== parsed.meta.title) errors.push(`posts/${number}: el título no coincide con blog.json`);
    if (registryPost.slug !== parsed.meta.slug) errors.push(`posts/${number}: el slug no coincide con blog.json`);
    if (registryPost.status !== parsed.meta.status) errors.push(`posts/${number}: el estado no coincide con blog.json`);
    if (registryPost.published_at !== parsed.meta.published_at) errors.push(`posts/${number}: la fecha no coincide con blog.json`);
  }
  posts.push({
    number,
    ...parsed,
    words,
    markdown: path.join(directory, markdownNames[0]),
    image: path.join(directory, jpegNames[0]),
  });
}

const paragraphMap = new Map();
const sentenceMap = new Map();
for (const post of posts) {
  for (const paragraph of post.body.split(/\r?\n\s*\r?\n/)) {
    const key = normalized(paragraph);
    if (key.length < 80 || key.startsWith("http")) continue;
    const list = paragraphMap.get(key) ?? [];
    list.push(post.number);
    paragraphMap.set(key, list);
  }
  for (const sentence of post.body.replace(/\r?\n/g, " ").split(/(?<=[.!?])\s+/u)) {
    const key = normalized(sentence);
    if (key.length < 80 || wordCount(key) < 12) continue;
    const list = sentenceMap.get(key) ?? [];
    list.push(post.number);
    sentenceMap.set(key, list);
  }
}
const duplicateParagraphs = [...paragraphMap.entries()].filter(([, numbers]) => new Set(numbers).size > 1);
const duplicateSentences = [...sentenceMap.entries()].filter(([, numbers]) => new Set(numbers).size > 1);
if (duplicateParagraphs.length) errors.push(`${duplicateParagraphs.length} grupos de párrafos exactos repetidos`);
if (duplicateSentences.length) errors.push(`${duplicateSentences.length} grupos de frases exactas repetidas`);

const published = posts.filter(post => post.meta.status === "published");
const scheduled = posts.filter(post => post.meta.status === "scheduled");
if (published.length !== 10) errors.push(`se esperaban 10 entradas publicadas y hay ${published.length}`);
if (scheduled.length !== 20) errors.push(`se esperaban 20 entradas futuras y hay ${scheduled.length}`);
const calendarDay = value => Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`);
const dayMs = 24 * 60 * 60 * 1000;
for (let index = 1; index < published.length; index += 1) {
  const difference = (calendarDay(published[index - 1].meta.published_at) - calendarDay(published[index].meta.published_at)) / dayMs;
  if (difference !== 1) errors.push(`las entradas públicas ${published[index - 1].number} y ${published[index].number} no tienen fechas consecutivas`);
}
if (scheduled.length) {
  const firstFutureDifference = (calendarDay(scheduled[0].meta.published_at) - calendarDay(published[0].meta.published_at)) / dayMs;
  if (firstFutureDifference !== 11) errors.push("la primera entrada futura no está a once días de la entrada 1");
}
for (let index = 1; index < scheduled.length; index += 1) {
  const difference = (calendarDay(scheduled[index].meta.published_at) - calendarDay(scheduled[index - 1].meta.published_at)) / dayMs;
  if (difference !== 11) errors.push(`las entradas futuras ${scheduled[index - 1].number} y ${scheduled[index].number} no están separadas once días`);
}
for (const post of posts) {
  const hour = Number(String(post.meta.published_at).slice(11, 13));
  if (hour < 9 || hour > 15) errors.push(`posts/${post.number}: la hora queda fuera de 09:00-15:59`);
}

if (manifest.items.length !== 30) errors.push(`el manifiesto contiene ${manifest.items.length} imágenes y no 30`);
const finalHashes = new Set();
for (const item of manifest.items) {
  const originalPath = path.join(root, ...item.original.split("/"));
  const finalPath = path.join(root, ...item.final.split("/"));
  if (!await exists(originalPath)) {
    errors.push(`falta el original ${item.original}`);
  } else if (sha256(await fs.readFile(originalPath)) !== item.original_sha256) {
    errors.push(`hash original incorrecto en la imagen ${item.number}`);
  }
  if (!await exists(finalPath)) {
    errors.push(`falta el JPG ${item.final}`);
  } else {
    const digest = sha256(await fs.readFile(finalPath));
    finalHashes.add(digest);
    if (digest !== item.final_sha256) errors.push(`hash final incorrecto en la imagen ${item.number}`);
    const blogPost = blog.posts.find(post => post.number === item.number);
    if (blogPost?.image_sha256 !== digest) errors.push(`blog.json no coincide con el hash de la imagen ${item.number}`);
  }
}
if (finalHashes.size !== 30) errors.push(`solo hay ${finalHashes.size} hashes finales únicos`);

const htmlFiles = (await walk(siteRoot)).filter(file => file.toLowerCase().endsWith(".html"));
let indexablePages = 0;
let totalH1 = 0;
let brokenInternal = 0;
let brokenImages = 0;
let forbiddenOutboundRel = 0;
let literalMarkdownH1 = 0;
for (const file of htmlFiles) {
  const relative = path.relative(siteRoot, file).replaceAll("\\", "/");
  const html = await fs.readFile(file, "utf8");
  const robots = html.match(/<meta name="robots" content="([^"]+)">/)?.[1] ?? "";
  const indexable = robots === "index,follow";
  if (indexable) indexablePages += 1;
  const h1Count = (html.match(/<h1(?:\s[^>]*)?>/g) ?? []).length;
  totalH1 += h1Count;
  if (h1Count !== 1) errors.push(`${relative}: contiene ${h1Count} H1`);
  if (/>\s*#\s+[^<]+</.test(html)) {
    literalMarkdownH1 += 1;
    errors.push(`${relative}: contiene un H1 Markdown literal`);
  }
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  let expectedCanonical;
  if (relative === "index.html") expectedCanonical = blog.url;
  else if (relative === "404.html") expectedCanonical = new URL("/404.html", blog.url).href;
  else expectedCanonical = new URL(`/${relative.replace(/index\.html$/, "")}`, blog.url).href;
  if (canonical !== expectedCanonical) errors.push(`${relative}: canonical incorrecta (${canonical ?? "ausente"})`);

  for (const tag of html.match(/<(?:a|img|link)[^>]+>/g) ?? []) {
    const match = tag.match(/\s(?:href|src)="([^"]+)"/);
    if (!match) continue;
    const reference = match[1];
    if (/^https?:\/\//.test(reference)) {
      if (/^<a\b/.test(tag)) {
        const rel = tag.match(/\srel="([^"]+)"/)?.[1] ?? "";
        if (/\b(?:nofollow|ugc|sponsored)\b/.test(rel)) forbiddenOutboundRel += 1;
      }
      continue;
    }
    if (!reference.startsWith("/") || reference.startsWith("//")) continue;
    const clean = reference.split(/[?#]/)[0];
    let target = path.join(siteRoot, ...clean.split("/").filter(Boolean));
    if (clean.endsWith("/")) target = path.join(target, "index.html");
    if (!await exists(target)) {
      brokenInternal += 1;
      if (/^<img\b/.test(tag)) brokenImages += 1;
      errors.push(`${relative}: referencia interna rota ${reference}`);
    }
  }
}

if (indexablePages !== 13) errors.push(`se esperaban 13 páginas indexables y hay ${indexablePages}`);
if (forbiddenOutboundRel) errors.push(`${forbiddenOutboundRel} enlaces salientes con rel prohibido`);
const sitemap = await fs.readFile(path.join(siteRoot, "sitemap.xml"), "utf8");
const sitemapCount = (sitemap.match(/<url>/g) ?? []).length;
if (sitemapCount !== 13) errors.push(`el sitemap contiene ${sitemapCount} URL y no 13`);
const publicAssets = (await fs.readdir(path.join(siteRoot, "assets"))).filter(name => /\.jpe?g$/i.test(name));
if (publicAssets.length !== 10) errors.push(`la compilación incluye ${publicAssets.length} JPG públicos y no 10`);
for (const post of scheduled) {
  if (await exists(path.join(siteRoot, "posts", post.meta.slug))) {
    errors.push(`la entrada futura ${post.number} aparece en la compilación pública`);
  }
}
const css = await fs.readFile(path.join(siteRoot, "assets", "styles.css"), "utf8");
for (const breakpoint of ["960px", "720px", "440px"]) {
  if (!css.includes(`max-width: ${breakpoint}`)) errors.push(`falta el breakpoint ${breakpoint}`);
}

const counts = posts.map(post => post.words);
const totalWords = counts.reduce((sum, count) => sum + count, 0);
const report = {
  status: errors.length ? "fail" : "pass",
  articles: posts.length,
  body_words_total: totalWords,
  body_words_min: Math.min(...counts),
  body_words_max: Math.max(...counts),
  body_words_average: Number((totalWords / posts.length).toFixed(1)),
  articles_at_least_700: counts.filter(count => count >= 700).length,
  exact_duplicate_paragraph_groups: duplicateParagraphs.length,
  exact_duplicate_sentence_groups: duplicateSentences.length,
  published_sources: published.length,
  future_sources: scheduled.length,
  html_files: htmlFiles.length,
  indexable_pages: indexablePages,
  sitemap_urls: sitemapCount,
  public_jpg_assets: publicAssets.length,
  unique_final_image_hashes: finalHashes.size,
  h1_total: totalH1,
  literal_markdown_h1_pages: literalMarkdownH1,
  broken_internal_references: brokenInternal,
  broken_images: brokenImages,
  outbound_links_with_forbidden_rel: forbiddenOutboundRel,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
