import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SITE_URL = "https://www.latentmachine.com";

function siteUrl() {
  return String(process.env.SITE_URL || DEFAULT_SITE_URL)
    .replace(/^([^:/?#]+)$/i, "https://$1")
    .replace(/\/+$/, "");
}

async function htmlFiles(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await htmlFiles(absolute, root));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      files.push(path.relative(root, absolute));
    }
  }

  return files;
}

function cleanPath(file) {
  const normalized = file.split(path.sep).join("/");
  if (normalized === "index.html") return "/";
  return `/${normalized.replace(/\.html$/i, "")}`;
}

function canonicalUrl(html, fallbackPath, baseUrl) {
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1] || "";
  if (/\bnoindex\b/i.test(robots)) return null;

  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  if (canonical) return normalizeUrl(canonical);

  return normalizeUrl(`${baseUrl}${fallbackPath === "/" ? "/" : fallbackPath}`);
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function priorityFor(url, baseUrl) {
  const pathName = url.replace(baseUrl, "") || "/";
  if (pathName === "/") return "1.0";
  if (pathName === "/contract") return "0.9";
  if (pathName === "/infer" || pathName === "/verify" || pathName === "/trace" || pathName === "/signal") return "0.8";
  if (pathName === "/latentlog") return "0.8";
  if (pathName.startsWith("/latentlog/")) return "0.7";
  return "0.6";
}

export async function build(root, outDir) {
  const baseUrl = siteUrl();
  const urls = [];

  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(path.join(outDir, file), "utf8");
    const url = canonicalUrl(html, cleanPath(file), baseUrl);
    if (!url) continue;
    urls.push(url);
  }

  const uniqueUrls = [...new Set(urls)].sort((a, b) => {
    if (a === `${baseUrl}/`) return -1;
    if (b === `${baseUrl}/`) return 1;
    return a.localeCompare(b);
  });

  const body = uniqueUrls.map(url => `  <url>
    <loc>${xmlEscape(url)}</loc>
    <priority>${priorityFor(url, baseUrl)}</priority>
  </url>`).join("\n");

  await writeFile(path.join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`);

  await writeFile(path.join(outDir, "robots.txt"), `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`);

  console.log(`Built sitemap with ${uniqueUrls.length} URL${uniqueUrls.length === 1 ? "" : "s"}.`);
}
