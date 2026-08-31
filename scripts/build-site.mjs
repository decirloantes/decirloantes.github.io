import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const blogRoot = process.env.BLOG_ROOT
  ? path.resolve(process.env.BLOG_ROOT)
  : path.resolve(scriptRoot, "..");
const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
if (Number.isNaN(now.valueOf())) throw new Error("La fecha de compilación no es válida.");

const blog = JSON.parse(await fs.readFile(path.join(blogRoot, "blog.json"), "utf8"));
const siteRoot = path.join(blogRoot, "site");
const postsRoot = path.join(blogRoot, "posts");
const sitePostsRoot = path.join(siteRoot, "posts");
const assetsRoot = path.join(siteRoot, "assets");

const identity = blog.identity ?? {};
const displayName = identity.display_name ?? "Autor";
const visual = blog.visual_identity ?? {};
const siteConfig = blog.static_site ?? {};
const assetVersion = siteConfig.asset_version ?? "1";
const mark = siteConfig.brand_mark ?? "•";
const eyebrow = siteConfig.eyebrow ?? "Cuaderno personal";
const heroTitle = siteConfig.hero_title ?? blog.description;
const heroIntro = siteConfig.hero_intro ?? `Escribe ${displayName}.`;
const cardTitle = siteConfig.card_title ?? "Últimas anotaciones";
const cardEyebrow = siteConfig.card_eyebrow ?? "Entradas recientes";
const readLabel = siteConfig.read_label ?? "Leer la anotación";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value);
  }
  return value;
}

function parseMarkdownDocument(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Falta el front matter YAML.");
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (field) meta[field[1]] = parseScalar(field[2]);
  }
  return { meta, body: match[2].trim() };
}

function inlineMarkdown(text) {
  const tokens = [];
  let value = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    const token = `@@LINK${tokens.length}@@`;
    tokens.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
    return token;
  });
  value = escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  tokens.forEach((token, index) => { value = value.replace(`@@LINK${index}@@`, token); });
  return value;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const wanted = unordered ? "ul" : "ol";
      if (listType !== wanted) { closeList(); listType = wanted; output.push(`<${wanted}>`); }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph(); closeList();
  return output.join("\n        ");
}

function words(text) {
  return text.replace(/[#*_`\[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: blog.timezone ?? "Europe/Madrid" }).format(new Date(value));
}

function canonicalFor(slug) {
  return new URL(`/posts/${slug}/`, blog.url).href;
}

function pageShell({ title, description, canonical, content, current = "", robots = "index,follow" }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(blog.title)}" href="/feed.xml">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/styles.css?v=${encodeURIComponent(assetVersion)}">
</head>
<body>
  <a class="skip" href="#contenido">Saltar al contenido</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="${escapeHtml(blog.title)}, inicio"><span class="brand-mark" aria-hidden="true">${escapeHtml(mark)}</span><span>${escapeHtml(blog.title)}</span></a>
    <nav aria-label="Navegación principal"><a${current === "home" ? ' aria-current="page"' : ""} href="/">Inicio</a><a${current === "archive" ? ' aria-current="page"' : ""} href="/archivo/">Archivo</a><a${current === "about" ? ' aria-current="page"' : ""} href="/acerca-de/">Acerca de</a></nav>
  </header>
  ${content}
  <footer><p><strong>${escapeHtml(blog.title)}</strong><br>Un blog de ${escapeHtml(displayName)}.</p><p>${escapeHtml(siteConfig.footer_note ?? blog.description)}</p></footer>
</body>
</html>
`;
}

const documents = [];
for (const entry of await fs.readdir(postsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
  const number = Number(entry.name);
  const directory = path.join(postsRoot, entry.name);
  const files = await fs.readdir(directory);
  const markdownFile = files.find(file => file.toLowerCase().endsWith(".md"));
  if (!markdownFile) continue;
  const { meta, body } = parseMarkdownDocument(await fs.readFile(path.join(directory, markdownFile), "utf8"));
  const plan = blog.content_plan?.find(item => item.number === number);
  const timestamp = meta.published_at ?? meta.scheduled_at ?? plan?.timestamp;
  const due = meta.status === "published" || (meta.status === "scheduled" && timestamp && new Date(timestamp) <= now);
  const imageFile = files.find(file => /\.(jpe?g)$/i.test(file));
  documents.push({ number, directory, markdownFile, imageFile, meta, body, timestamp, due });
}

const duePosts = documents.filter(post => post.due).sort((a, b) => a.number - b.number);
const displayPosts = [...duePosts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
await fs.rm(sitePostsRoot, { recursive: true, force: true });
await fs.mkdir(sitePostsRoot, { recursive: true });
await fs.mkdir(assetsRoot, { recursive: true });
for (const asset of await fs.readdir(assetsRoot)) {
  if (/\.jpe?g$/i.test(asset)) await fs.rm(path.join(assetsRoot, asset), { force: true });
}

for (let index = 0; index < duePosts.length; index++) {
  const post = duePosts[index];
  const slug = post.meta.slug;
  const assetName = `${slug}.jpg`;
  if (post.imageFile) await fs.copyFile(path.join(post.directory, post.imageFile), path.join(assetsRoot, assetName));
  const reading = Math.max(1, Math.round(words(post.body) / 180));
  const category = Array.isArray(post.meta.categories) ? post.meta.categories[0] : "Anotación";
  const previous = duePosts[index - 1];
  const next = duePosts[index + 1];
  const navigation = [previous ? `<a href="/posts/${previous.meta.slug}/">← ${escapeHtml(previous.meta.title)}</a>` : `<a href="/">← Volver al inicio</a>`, next ? `<a href="/posts/${next.meta.slug}/">${escapeHtml(next.meta.title)} →</a>` : ""].join("");
  const article = `<main id="contenido" class="article-wrap">
    <article>
      <header class="article-header">
        <p class="category">${escapeHtml(category)}</p>
        <h1>${escapeHtml(post.meta.title)}</h1>
        <p class="dek">${escapeHtml(post.meta.summary)}</p>
        <div class="byline"><span>Por ${escapeHtml(post.meta.author ?? displayName)}</span><time datetime="${escapeHtml(String(post.timestamp).slice(0, 10))}">${escapeHtml(formatDate(post.timestamp))}</time><span>${reading} min de lectura</span></div>
      </header>
      ${post.imageFile ? `<figure class="article-image"><img src="/assets/${escapeHtml(assetName)}" width="766" height="509" alt="${escapeHtml(post.meta.image_alt)}"></figure>` : ""}
      <div class="prose">
        ${markdownToHtml(post.body)}
      </div>
    </article>
    <nav class="article-nav" aria-label="Navegación entre entradas">${navigation}</nav>
  </main>`;
  const html = pageShell({ title: post.meta.title, description: post.meta.summary, canonical: canonicalFor(slug), content: article });
  const outputDirectory = path.join(sitePostsRoot, slug);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "index.html"), html, "utf8");
}

const cards = displayPosts.slice(0, 10).map(post => {
  const reading = Math.max(1, Math.round(words(post.body) / 180));
  const category = Array.isArray(post.meta.categories) ? post.meta.categories[0] : "Anotación";
  return `<article class="post-card">
        <a class="image-link" href="/posts/${escapeHtml(post.meta.slug)}/"><img src="/assets/${escapeHtml(post.meta.slug)}.jpg" width="766" height="509" alt="${escapeHtml(post.meta.image_alt)}"></a>
        <div class="post-copy">
          <p class="category">${escapeHtml(category)} · ${reading} min</p>
          <h3><a href="/posts/${escapeHtml(post.meta.slug)}/">${escapeHtml(post.meta.title)}</a></h3>
          <p>${escapeHtml(post.meta.summary)}</p>
          <a class="read-more" href="/posts/${escapeHtml(post.meta.slug)}/">${escapeHtml(readLabel)} <span aria-hidden="true">→</span></a>
        </div>
      </article>`;
}).join("\n      ");

const availabilityLabel = duePosts.length === 1 ? "1 entrada disponible" : `${duePosts.length} entradas disponibles`;
const homepage = `<main id="contenido">
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(heroTitle)}</h1><p class="intro">${escapeHtml(heroIntro)}</p></div>
      <aside class="signal-card" aria-label="Idea del blog"><span class="signal-dot"></span><strong>${escapeHtml(siteConfig.signal_title ?? "Una idea cada vez")}</strong><p>${escapeHtml(siteConfig.signal_text ?? blog.purpose)}</p></aside>
    </section>
    <section class="latest" aria-labelledby="ultimas">
      <div class="section-heading"><div><p class="eyebrow">${escapeHtml(cardEyebrow)}</p><h2 id="ultimas">${escapeHtml(cardTitle)}</h2></div><p>${escapeHtml(availabilityLabel)}</p></div>
      ${cards}
${duePosts.length > 10 ? '      <p class="archive-link"><a href="/archivo/">Ver todas las entradas →</a></p>\n' : ""}
    </section>
  </main>`;
await fs.writeFile(path.join(siteRoot, "index.html"), pageShell({ title: `${blog.title} | ${displayName}`, description: blog.description, canonical: blog.url, content: homepage, current: "home" }), "utf8");

const archiveItems = displayPosts.map(post => `<li><time datetime="${escapeHtml(String(post.timestamp).slice(0, 10))}">${escapeHtml(formatDate(post.timestamp))}</time><a href="/posts/${escapeHtml(post.meta.slug)}/">${escapeHtml(post.meta.title)}</a><p>${escapeHtml(post.meta.summary)}</p></li>`).join("\n");
const archive = `<main id="contenido" class="archive-wrap"><p class="eyebrow">Todas las entradas</p><h1>Archivo</h1><p class="archive-intro">Notas publicadas por Nora Vidal, ordenadas de la más reciente a la más antigua.</p><ol class="archive-list">${archiveItems}</ol></main>`;
await fs.mkdir(path.join(siteRoot, "archivo"), { recursive: true });
await fs.writeFile(path.join(siteRoot, "archivo", "index.html"), pageShell({ title: `Archivo | ${blog.title}`, description: `Archivo de entradas de ${blog.title}.`, canonical: new URL("/archivo/", blog.url).href, content: archive, current: "archive" }), "utf8");

const about = `<main id="contenido" class="about-wrap"><p class="eyebrow">Acerca de</p><h1>${escapeHtml(blog.title)}</h1><div class="about-grid"><p class="about-lead">${escapeHtml(identity.public_introduction ?? blog.description)}</p><div class="about-body"><p>${escapeHtml(blog.purpose)}</p><p>${escapeHtml(siteConfig.about_note ?? "Aquí las entradas nacen de una observación concreta y buscan dejar una prueba pequeña que se pueda entender y repetir.")}</p></div></div></main>`;
await fs.mkdir(path.join(siteRoot, "acerca-de"), { recursive: true });
await fs.writeFile(path.join(siteRoot, "acerca-de", "index.html"), pageShell({ title: `Acerca de | ${blog.title}`, description: identity.public_introduction ?? blog.description, canonical: new URL("/acerca-de/", blog.url).href, content: about, current: "about" }), "utf8");

const sitemapUrls = [blog.url, new URL("/archivo/", blog.url).href, new URL("/acerca-de/", blog.url).href, ...duePosts.map(post => canonicalFor(post.meta.slug))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
await fs.writeFile(path.join(siteRoot, "sitemap.xml"), sitemap, "utf8");
await fs.writeFile(path.join(siteRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", blog.url).href}\n`, "utf8");

const rssItems = displayPosts.slice(0, 20).map(post => `  <item>\n    <title>${escapeHtml(post.meta.title)}</title>\n    <link>${escapeHtml(canonicalFor(post.meta.slug))}</link>\n    <guid>${escapeHtml(canonicalFor(post.meta.slug))}</guid>\n    <pubDate>${new Date(post.timestamp).toUTCString()}</pubDate>\n    <description>${escapeHtml(post.meta.summary)}</description>\n  </item>`).join("\n");
const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n  <title>${escapeHtml(blog.title)}</title>\n  <link>${escapeHtml(blog.url)}</link>\n  <description>${escapeHtml(blog.description)}</description>\n  <language>es-ES</language>\n${rssItems}\n</channel></rss>\n`;
await fs.writeFile(path.join(siteRoot, "feed.xml"), feed, "utf8");

const notFound = `<main id="contenido" class="not-found"><p class="eyebrow">Página no encontrada</p><h1>Esta conversación no está aquí.</h1><p>Puede que la dirección haya cambiado o que la entrada todavía no se haya publicado.</p><p><a class="read-more" href="/">Volver al inicio →</a></p></main>`;
await fs.writeFile(path.join(siteRoot, "404.html"), pageShell({ title: `Página no encontrada | ${blog.title}`, description: "La página solicitada no está disponible.", canonical: blog.url, content: notFound, robots: "noindex,follow" }), "utf8");

console.log(JSON.stringify({ blog: blog.title, built_at: now.toISOString(), local_documents: documents.length, public_documents: duePosts.length }, null, 2));
