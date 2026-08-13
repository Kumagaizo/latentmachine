import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://www.latentmachine.com";
let partials = new Map();

export async function build(root, outDir) {
  const articlesDir = path.join(root, "articles");
  const latentlogDir = path.join(outDir, "latentlog");
  let files = [];

  try {
    files = (await readdir(articlesDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    files = [];
  }

  await mkdir(latentlogDir, { recursive: true });
  partials = await loadPartials(root);

  const articles = [];
  const seenSlugs = new Set();

  for (const file of files) {
    const content = await readFile(path.join(articlesDir, file), "utf8");
    const { meta, body } = parseFrontmatter(content, file);
    const slug = slugFromFilename(file);

    if (!slug) {
      throw new Error(`${file}: filename must contain at least one letter or number`);
    }

    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate Latentlog slug "${slug}" generated from ${file}`);
    }

    seenSlugs.add(slug);
    articles.push({ meta, body, slug });
  }

  articles.sort((a, b) => b.meta.date.localeCompare(a.meta.date));

  for (const article of articles) {
    const bodyHtml = markdownToHtml(article.body);
    await writeFile(
      path.join(latentlogDir, `${article.slug}.html`),
      injectPartials(articlePageHtml(article, bodyHtml, relatedArticles(article, articles))),
    );
  }

  await writeFile(path.join(outDir, "latentlog.html"), injectPartials(indexPageHtml(articles)));

  console.log(`Built ${articles.length} Latentlog article${articles.length === 1 ? "" : "s"}.`);
}

async function loadPartials(root) {
  const loaded = new Map();
  for (const name of ["head-commons", "nav", "footer"]) {
    loaded.set(name, await readFile(path.join(root, "partials", `${name}.html`), "utf8"));
  }
  return loaded;
}

function injectPartials(text) {
  return text.replace(/<!--@partial:([a-z-]+)-->/g, (token, name) => {
    if (!partials.has(name)) throw new Error(`Missing partial for generated article page: ${token}`);
    return partials.get(name);
  });
}

function parseFrontmatter(content, file) {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) throw new Error(`${file}: missing frontmatter`);

  const meta = {};
  for (const line of match[1].split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }

  for (const field of ["title", "description", "date"]) {
    if (!meta[field]) throw new Error(`${file}: frontmatter missing "${field}"`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    throw new Error(`${file}: date must use YYYY-MM-DD`);
  }

  return { meta, body: match[2].trim() };
}

function metaTags(meta) {
  return String(meta.tags || "")
    .split(",")
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
}

function slugFromFilename(file) {
  const base = path.basename(file, path.extname(file));
  return base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]*)$/);
    if (fence) {
      flushParagraph();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      const language = fence[1] || "text";
      blocks.push(`<pre><code class="language-${escapeAttr(language)}">${escapeHtml(code.join("\n").trim())}</code></pre>`);
      continue;
    }

    const heading = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push(`<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      blocks.push('<hr class="divider" />');
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      const items = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(`<li>${inlineHtml(lines[index].trim().slice(2))}</li>`);
        index += 1;
      }
      index -= 1;
      blocks.push(`<ul>\n${items.join("\n")}\n</ul>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks.join("\n\n");
}

function inlineHtml(text) {
  const codeSpans = [];
  let html = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = escapeHtml(html)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeHref(href);
      if (!safeHref) return label;
      return `<a href="${safeHref}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  codeSpans.forEach((code, index) => {
    html = html.replace(`@@CODE${index}@@`, code);
  });

  return html;
}

function sanitizeHref(href) {
  const value = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(value)) return escapeAttr(value);
  return "";
}

function articleItemHtml(article) {
  return `<a class="article-item" href="/latentlog/${article.slug}">
          <time class="article-item-date" datetime="${escapeAttr(article.meta.date)}">${formatDate(article.meta.date)}</time>
          <h2 class="article-item-title">${escapeHtml(article.meta.title)}</h2>
          <p class="article-item-description">${escapeHtml(article.meta.description)}</p>
        </a>`;
}

function relatedArticles(current, articles) {
  const currentTags = new Set(metaTags(current.meta));
  const scored = articles
    .filter(article => article.slug !== current.slug)
    .map(article => ({
      article,
      score: metaTags(article.meta).filter(tag => currentTags.has(tag)).length,
    }))
    .sort((a, b) => b.score - a.score
      || b.article.meta.date.localeCompare(a.article.meta.date)
      || a.article.slug.localeCompare(b.article.slug));

  const related = scored.filter(item => item.score > 0).map(item => item.article);
  for (const item of scored) {
    if (related.length >= 3) break;
    if (!related.includes(item.article)) related.push(item.article);
  }

  return related.slice(0, 3);
}

function articlePageHtml(article, bodyHtml, related) {
  const { meta, slug } = article;
  const canonicalUrl = `${SITE_URL}/latentlog/${slug}`;
  const dateFormatted = formatDate(meta.date);
  const relatedHtml = related.map(articleItemHtml).join("\n");
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    dateModified: meta.modified || meta.date,
    author: { "@type": "Person", name: "Sandro" },
    publisher: { "@type": "Organization", name: "Latentmachine" },
    url: canonicalUrl,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <!--@partial:head-commons-->
    <title>${escapeHtml(meta.title)} | Latentlog</title>
    <meta name="description" content="${escapeAttr(meta.description)}" />
    <link rel="canonical" href="${canonicalUrl}" />

    <meta property="og:title" content="${escapeAttr(meta.title)}" />
    <meta property="og:description" content="${escapeAttr(meta.description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonicalUrl}" />

    <script type="application/ld+json">${structuredData.replace(/</g, "\\u003c")}</script>
  </head>
  <body>
    <main class="page">
      <a href="#main-content" class="skip-link">Skip to content</a>
      <!--@partial:nav-->
      <div id="main-content">
        <article class="content-page">
          <a class="section-label" href="/latentlog">Back to Latentlog</a>
          <h1>${escapeHtml(meta.title)}</h1>
          <time class="article-date" datetime="${escapeAttr(meta.date)}">${dateFormatted}</time>

${bodyHtml}
          <a class="button is-primary" href="/verify">Check a batch &rarr;</a>
          <hr class="divider" />
          <section aria-label="Related articles">
            <p class="section-label">Related</p>
            <div class="article-list">
${relatedHtml}
            </div>
          </section>
        </article>
      </div>
      <!--@partial:footer-->
    </main>
    <script type="module" src="/src/local/chrome.js"></script>
  </body>
</html>`;
}

function indexPageHtml(articles) {
  const listItems = articles.length
    ? articles.map(article => `
        ${articleItemHtml(article)}`).join("\n")
    : '<p class="article-empty">Articles will appear here as soon as a markdown file lands in the articles folder.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <!--@partial:head-commons-->
    <title>Latentlog | Latentmachine Articles</title>
    <meta name="description" content="Technical notes on data transformation, rule inference, automation workflows, and the building of Latentmachine." />
    <link rel="canonical" href="${SITE_URL}/latentlog" />

    <meta property="og:title" content="Latentlog | Latentmachine Articles" />
    <meta property="og:description" content="Technical notes on data transformation, rule inference, and the building of Latentmachine." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SITE_URL}/latentlog" />
  </head>
  <body>
    <main class="page">
      <a href="#main-content" class="skip-link">Skip to content</a>
      <!--@partial:nav-->
      <div id="main-content">
        <article class="content-page">
          <p class="section-label">Latentlog</p>
          <h1>Notes from the machine room.</h1>
          <p>Technical writing on data transformation, rule inference, automation patterns, and the things we are learning while building Latentmachine.</p>

          <div class="article-list">
${listItems}
          </div>
        </article>
      </div>
      <!--@partial:footer-->
    </main>
    <script type="module" src="/src/local/chrome.js"></script>
  </body>
</html>`;
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, "&#039;");
}
