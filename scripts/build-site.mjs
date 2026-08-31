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
const sourceAssetsRoot = path.join(blogRoot, "assets");

const identity = blog.identity ?? {};
const displayName = identity.display_name ?? "Nora Vidal";
const siteConfig = blog.static_site ?? {};
const assetVersion = siteConfig.asset_version ?? "1";
const eyebrow = siteConfig.eyebrow ?? "Un cuaderno para conversaciones pendientes";
const heroTitle = siteConfig.hero_title ?? blog.description;
const heroIntro = siteConfig.hero_intro ?? `Escribe ${displayName}.`;
const readLabel = siteConfig.read_label ?? "Abrir la nota";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("[") && value.endsWith("]"))
  ) {
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

function headingKey(value = "") {
  return value
    .replace(/[*_`]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function removeDuplicateTitleHeading(body, title) {
  const lines = body.split(/\r?\n/);
  const firstContent = lines.findIndex(line => line.trim());
  if (firstContent < 0) return body;
  const heading = lines[firstContent].match(/^#\s+(.+)$/);
  if (heading && headingKey(heading[1]) === headingKey(title)) {
    lines.splice(firstContent, 1);
  }
  return lines.join("\n").trim();
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
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  tokens.forEach((token, index) => {
    value = value.replace(`@@LINK${index}@@`, token);
  });
  return value;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (quote.length) output.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      flushQuote();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = Math.max(2, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const quoted = line.match(/^>\s*(.+)$/);
    if (quoted) {
      flushParagraph();
      closeList();
      quote.push(quoted[1]);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const wanted = unordered ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        listType = wanted;
        output.push(`<${wanted}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  flushQuote();
  return output.join("\n        ");
}

function wordCount(text) {
  const plain = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`\[\]()>|]/g, " ");
  return plain.match(/\b[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*\b/gu)?.length ?? 0;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: blog.timezone ?? "Europe/Madrid",
  }).format(new Date(value));
}

function canonicalFor(slug) {
  return new URL(`/posts/${slug}/`, blog.url).href;
}

function pageShell({
  title,
  description,
  canonical,
  content,
  current = "",
  robots = "index,follow",
  type = "website",
  image = "",
}) {
  const socialImage = image ? new URL(image, blog.url).href : "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="${escapeHtml(displayName)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="theme-color" content="#4b244a">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(blog.title)}" href="/feed.xml">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/styles.css?v=${encodeURIComponent(assetVersion)}">
  <meta property="og:locale" content="es_ES">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:site_name" content="${escapeHtml(blog.title)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  ${socialImage ? `<meta property="og:image" content="${escapeHtml(socialImage)}">` : ""}
</head>
<body>
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <div class="top-rule" aria-hidden="true"><span></span><span></span><span></span></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="${escapeHtml(blog.title)}, inicio">
      <span class="brand-kicker">Cuaderno de ${escapeHtml(displayName)}</span>
      <span class="brand-name">${escapeHtml(blog.title)}</span>
    </a>
    <nav aria-label="Navegación principal">
      <a${current === "home" ? ' aria-current="page"' : ""} href="/">Inicio</a>
      <a${current === "archive" ? ' aria-current="page"' : ""} href="/archivo/">Archivo</a>
      <a${current === "about" ? ' aria-current="page"' : ""} href="/acerca-de/">Sobre Nora</a>
    </nav>
  </header>
  ${content}
  <footer class="site-footer">
    <div class="footer-grid">
      <div>
        <p class="footer-label">Decirlo antes</p>
        <p>Un cuaderno personal de ${escapeHtml(displayName)} sobre palabras que ayudan a pedir, aclarar y poner límites sin añadir ruido.</p>
      </div>
      <div>
        <p class="footer-label">Seguir leyendo</p>
        <p><a href="/archivo/">Archivo completo</a><br><a href="/acerca-de/">Sobre Nora</a><br><a href="/feed.xml">Suscripción RSS</a></p>
      </div>
      <div>
        <p class="footer-label">Cuando una frase no basta</p>
        <p>Si hay amenazas, coacción o peligro, conviene priorizar la seguridad y buscar apoyo. En España, el <a href="https://violenciagenero.igualdad.gob.es/informacion-3/recursos/telefono016/">016 ofrece información y atención</a>.</p>
      </div>
    </div>
    <p class="footer-baseline">Notas para conversaciones cotidianas. No sustituyen ayuda profesional ni servicios de emergencia.</p>
  </footer>
</body>
</html>
`;
}

await fs.mkdir(siteRoot, { recursive: true });
await fs.mkdir(sitePostsRoot, { recursive: true });
await fs.mkdir(assetsRoot, { recursive: true });

for (const name of ["styles.css", "favicon.svg"]) {
  const source = path.join(sourceAssetsRoot, name);
  try {
    await fs.copyFile(source, path.join(assetsRoot, name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const documents = [];
for (const entry of await fs.readdir(postsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
  const number = Number(entry.name);
  const directory = path.join(postsRoot, entry.name);
  const files = await fs.readdir(directory);
  const markdownFile = files.find(file => file.toLowerCase().endsWith(".md"));
  if (!markdownFile) continue;
  const parsed = parseMarkdownDocument(await fs.readFile(path.join(directory, markdownFile), "utf8"));
  const body = removeDuplicateTitleHeading(parsed.body, parsed.meta.title);
  const plan = blog.content_plan?.find(item => item.number === number);
  const timestamp = parsed.meta.published_at ?? parsed.meta.scheduled_at ?? plan?.timestamp;
  const due = parsed.meta.status === "published"
    || (parsed.meta.status === "scheduled" && timestamp && new Date(timestamp) <= now);
  const imageFile = files.find(file => /\.(jpe?g)$/i.test(file));
  documents.push({
    number,
    directory,
    markdownFile,
    imageFile,
    meta: parsed.meta,
    body,
    timestamp,
    due,
  });
}

const duePosts = documents
  .filter(post => post.due)
  .sort((a, b) => a.number - b.number);
const displayPosts = [...duePosts]
  .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

await fs.rm(sitePostsRoot, { recursive: true, force: true });
await fs.mkdir(sitePostsRoot, { recursive: true });
for (const asset of await fs.readdir(assetsRoot)) {
  if (/\.jpe?g$/i.test(asset)) {
    await fs.rm(path.join(assetsRoot, asset), { force: true });
  }
}

for (let index = 0; index < duePosts.length; index += 1) {
  const post = duePosts[index];
  const slug = post.meta.slug;
  const assetName = `${slug}.jpg`;
  if (post.imageFile) {
    await fs.copyFile(
      path.join(post.directory, post.imageFile),
      path.join(assetsRoot, assetName),
    );
  }
  const reading = Math.max(1, Math.round(wordCount(post.body) / 180));
  const category = Array.isArray(post.meta.categories)
    ? post.meta.categories[0]
    : "Conversaciones";
  const newer = duePosts[index - 1];
  const older = duePosts[index + 1];
  const navigation = [
    newer
      ? `<a href="/posts/${newer.meta.slug}/"><span>Más reciente</span>${escapeHtml(newer.meta.title)}</a>`
      : `<a href="/"><span>Volver</span>Inicio</a>`,
    older
      ? `<a class="next" href="/posts/${older.meta.slug}/"><span>Entrada anterior</span>${escapeHtml(older.meta.title)}</a>`
      : "",
  ].join("");
  const article = `<main id="contenido" class="article-layout">
    <aside class="article-margin" aria-label="Datos de la entrada">
      <span class="entry-number">N.º ${String(post.number).padStart(2, "0")}</span>
      <p>Una nota para leer despacio y adaptar a la conversación real.</p>
    </aside>
    <article class="article-sheet">
      <header class="article-header">
        <p class="category">${escapeHtml(category)}</p>
        <h1>${escapeHtml(post.meta.title)}</h1>
        <p class="dek">${escapeHtml(post.meta.summary)}</p>
        <div class="byline">
          <span>Por ${escapeHtml(post.meta.author ?? displayName)}</span>
          <time datetime="${escapeHtml(String(post.timestamp).slice(0, 10))}">${escapeHtml(formatDate(post.timestamp))}</time>
          <span>${reading} min de lectura</span>
        </div>
      </header>
      ${post.imageFile ? `<figure class="article-image"><img src="/assets/${escapeHtml(assetName)}" width="1280" height="853" alt="${escapeHtml(post.meta.image_alt)}"></figure>` : ""}
      <div class="prose">
        ${markdownToHtml(post.body)}
      </div>
    </article>
    <nav class="article-nav" aria-label="Navegación entre entradas">${navigation}</nav>
  </main>`;
  const html = pageShell({
    title: post.meta.title,
    description: post.meta.summary,
    canonical: canonicalFor(slug),
    content: article,
    type: "article",
    image: `/assets/${assetName}`,
  });
  const outputDirectory = path.join(sitePostsRoot, slug);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "index.html"), html, "utf8");
}

const featured = displayPosts[0];
const remaining = displayPosts.slice(1);
const featuredReading = featured ? Math.max(1, Math.round(wordCount(featured.body) / 180)) : 0;
const featuredMarkup = featured
  ? `<article class="featured-entry">
      <a class="featured-image" href="/posts/${escapeHtml(featured.meta.slug)}/">
        <img src="/assets/${escapeHtml(featured.meta.slug)}.jpg" width="1280" height="853" alt="${escapeHtml(featured.meta.image_alt)}">
      </a>
      <div class="featured-copy">
        <p class="entry-index">Entrada ${String(featured.number).padStart(2, "0")} · ${featuredReading} min</p>
        <h2><a href="/posts/${escapeHtml(featured.meta.slug)}/">${escapeHtml(featured.meta.title)}</a></h2>
        <p>${escapeHtml(featured.meta.summary)}</p>
        <a class="ink-link" href="/posts/${escapeHtml(featured.meta.slug)}/">${escapeHtml(readLabel)} <span aria-hidden="true">↗</span></a>
      </div>
    </article>`
  : "";

const cards = remaining.map(post => {
  const reading = Math.max(1, Math.round(wordCount(post.body) / 180));
  return `<article class="note-card">
        <a class="note-image" href="/posts/${escapeHtml(post.meta.slug)}/"><img src="/assets/${escapeHtml(post.meta.slug)}.jpg" width="1280" height="853" alt="${escapeHtml(post.meta.image_alt)}"></a>
        <div class="note-copy">
          <p class="entry-index">N.º ${String(post.number).padStart(2, "0")} · ${reading} min</p>
          <h3><a href="/posts/${escapeHtml(post.meta.slug)}/">${escapeHtml(post.meta.title)}</a></h3>
          <p>${escapeHtml(post.meta.summary)}</p>
        </div>
      </article>`;
}).join("\n      ");

const homepage = `<main id="contenido">
    <section class="home-hero">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(heroTitle)}</h1>
        <p class="hero-intro">${escapeHtml(heroIntro)}</p>
      </div>
      <aside class="margin-note" aria-label="Una nota de Nora">
        <p class="margin-note-label">En el margen</p>
        <p>${escapeHtml(siteConfig.margin_note ?? "La frase útil no lo explica todo. Nombra lo que ocurre, dice qué necesitas y deja una pregunta que se pueda contestar.")}</p>
        <span>${escapeHtml(displayName)}</span>
      </aside>
    </section>
    <section class="featured-section" aria-labelledby="reciente">
      <div class="section-intro">
        <p class="eyebrow">La más reciente</p>
        <p>${duePosts.length} notas disponibles</p>
      </div>
      <h2 class="visually-hidden" id="reciente">Entrada más reciente</h2>
      ${featuredMarkup}
    </section>
    <section class="notebook-section" aria-labelledby="cuaderno">
      <header class="notebook-heading">
        <div><p class="eyebrow">Páginas abiertas</p><h2 id="cuaderno">Del cuaderno</h2></div>
        <p>Peticiones, límites, aclaraciones y disculpas para situaciones cotidianas.</p>
      </header>
      <div class="note-grid">${cards}</div>
      <p class="archive-callout"><a href="/archivo/">Recorrer el archivo <span aria-hidden="true">→</span></a></p>
    </section>
  </main>`;

await fs.writeFile(
  path.join(siteRoot, "index.html"),
  pageShell({
    title: `${blog.title} | ${displayName}`,
    description: blog.description,
    canonical: blog.url,
    content: homepage,
    current: "home",
    image: featured ? `/assets/${featured.meta.slug}.jpg` : "",
  }),
  "utf8",
);

const archiveItems = displayPosts.map(post => `<li>
      <div class="archive-date"><span>N.º ${String(post.number).padStart(2, "0")}</span><time datetime="${escapeHtml(String(post.timestamp).slice(0, 10))}">${escapeHtml(formatDate(post.timestamp))}</time></div>
      <div><h2><a href="/posts/${escapeHtml(post.meta.slug)}/">${escapeHtml(post.meta.title)}</a></h2><p>${escapeHtml(post.meta.summary)}</p></div>
    </li>`).join("\n");
const archive = `<main id="contenido" class="archive-wrap">
    <header class="page-heading"><p class="eyebrow">Todas las páginas</p><h1>Archivo</h1><p>Las notas publicadas, de la más reciente a la más antigua. Las futuras permanecen guardadas hasta su fecha.</p></header>
    <ol class="archive-list">${archiveItems}</ol>
  </main>`;
await fs.mkdir(path.join(siteRoot, "archivo"), { recursive: true });
await fs.writeFile(
  path.join(siteRoot, "archivo", "index.html"),
  pageShell({
    title: `Archivo | ${blog.title}`,
    description: `Archivo de entradas de ${blog.title}.`,
    canonical: new URL("/archivo/", blog.url).href,
    content: archive,
    current: "archive",
  }),
  "utf8",
);

const about = `<main id="contenido" class="about-wrap">
    <header class="page-heading"><p class="eyebrow">La persona al otro lado</p><h1>Hola, soy ${escapeHtml(displayName)}.</h1></header>
    <div class="about-grid">
      <p class="about-lead">${escapeHtml(identity.public_introduction ?? blog.description)}</p>
      <div class="about-body">
        <p>Me interesan esas conversaciones pequeñas que se vuelven pesadas porque nadie encuentra una primera frase. En este cuaderno reúno maneras de pedir algo concreto, corregir un malentendido, disculparse por una acción o marcar un límite propio.</p>
        <p>No todas las situaciones se resuelven hablando mejor. Si hay miedo, control, amenazas o peligro, lo importante es la seguridad y el apoyo adecuado. Para emergencias está el 112 y, en España, el <a href="https://violenciagenero.igualdad.gob.es/informacion-3/recursos/telefono016/">servicio 016</a> ofrece atención especializada.</p>
      </div>
      <aside class="about-note"><p>Me gusta una frase que pueda decirse en voz alta, sin adivinar la intención ajena y sin esconder la petición al final.</p></aside>
    </div>
  </main>`;
await fs.mkdir(path.join(siteRoot, "acerca-de"), { recursive: true });
await fs.writeFile(
  path.join(siteRoot, "acerca-de", "index.html"),
  pageShell({
    title: `Sobre Nora | ${blog.title}`,
    description: identity.public_introduction ?? blog.description,
    canonical: new URL("/acerca-de/", blog.url).href,
    content: about,
    current: "about",
  }),
  "utf8",
);

const sitemapUrls = [
  blog.url,
  new URL("/archivo/", blog.url).href,
  new URL("/acerca-de/", blog.url).href,
  ...duePosts.map(post => canonicalFor(post.meta.slug)),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
await fs.writeFile(path.join(siteRoot, "sitemap.xml"), sitemap, "utf8");
await fs.writeFile(
  path.join(siteRoot, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", blog.url).href}\n`,
  "utf8",
);

const rssItems = displayPosts.slice(0, 20).map(post => `  <item>
    <title>${escapeHtml(post.meta.title)}</title>
    <link>${escapeHtml(canonicalFor(post.meta.slug))}</link>
    <guid>${escapeHtml(canonicalFor(post.meta.slug))}</guid>
    <pubDate>${new Date(post.timestamp).toUTCString()}</pubDate>
    <description>${escapeHtml(post.meta.summary)}</description>
  </item>`).join("\n");
const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>
  <title>${escapeHtml(blog.title)}</title>
  <link>${escapeHtml(blog.url)}</link>
  <description>${escapeHtml(blog.description)}</description>
  <language>es-ES</language>
${rssItems}
</channel></rss>\n`;
await fs.writeFile(path.join(siteRoot, "feed.xml"), feed, "utf8");

const notFound = `<main id="contenido" class="not-found">
    <p class="eyebrow">Página no encontrada</p>
    <h1>Esta conversación no está aquí.</h1>
    <p>Puede que la dirección haya cambiado o que la entrada todavía no se haya publicado.</p>
    <p><a class="ink-link" href="/">Volver al inicio <span aria-hidden="true">→</span></a></p>
  </main>`;
await fs.writeFile(
  path.join(siteRoot, "404.html"),
  pageShell({
    title: `Página no encontrada | ${blog.title}`,
    description: "La página solicitada no está disponible.",
    canonical: new URL("/404.html", blog.url).href,
    content: notFound,
    robots: "noindex,follow",
  }),
  "utf8",
);
await fs.writeFile(path.join(siteRoot, ".nojekyll"), "", "utf8");

console.log(JSON.stringify({
  blog: blog.title,
  built_at: now.toISOString(),
  local_documents: documents.length,
  public_documents: duePosts.length,
  body_words: documents.reduce((sum, post) => sum + wordCount(post.body), 0),
}, null, 2));
