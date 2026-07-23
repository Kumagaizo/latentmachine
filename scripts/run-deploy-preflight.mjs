import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.includes("--source")
  ? "source"
  : process.argv.includes("--dist")
    ? "dist"
    : "all";

const sourceVendorFiles = [
  "src/vendor/yaml/index.js",
  "src/vendor/yaml/dist/index.js",
  "src/vendor/yaml/dist/parse/parser.js",
  "src/vendor/yaml/dist/stringify/stringify.js",
  "src/vendor/yaml/LICENSE",
  "src/vendor/yaml.VENDORED.md",
];

const expectedDistFonts = [
  "MartianMono-VariableFont_wdth,wght.ttf",
  "StackSansText-VariableFont_wght.ttf",
];

const browserScriptEntries = [
  "src/local/app.js",
  "src/local/verify.js",
  "src/local/regex.js",
  "src/local/jq.js",
  "src/local/landing-demo.js",
  "src/local/chrome.js",
];

const canonicalOrigin = "https://latentmachine.com";
const artifactBudgets = {
  rawBytes: 2_500_000,
  gzipBytes: 800_000,
  brotliBytes: 700_000,
};

async function exists(relativePath) {
  await access(path.join(root, relativePath));
}

async function fileExists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function assertFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  const info = await stat(fullPath);
  assert.equal(info.isFile(), true, `${relativePath} must be a file`);
}

async function assertNoPackageDependency() {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.equal(pkg[field]?.yaml, undefined, `Do not add yaml to package.json ${field}; use the audited vendored copy.`);
  }
}

async function assertGitignoreKeepsVendorDistTrackable() {
  const text = await readFile(path.join(root, ".gitignore"), "utf8");
  assert.match(text, /^\/dist\/$/m, ".gitignore should ignore only the root build output with /dist/");
  assert.doesNotMatch(text, /^dist\/$/m, ".gitignore must not use unanchored dist/ because it hides src/vendor/yaml/dist/");
}

async function assertSourceVendor() {
  for (const file of sourceVendorFiles) await assertFile(file);
}

function localJavaScriptImports(source, text) {
  const imports = [];
  const pattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  let match;

  while ((match = pattern.exec(text))) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;

    const resolved = path.resolve(path.dirname(source), specifier);
    imports.push(path.extname(resolved) ? resolved : `${resolved}.js`);
  }

  return imports;
}

function moduleScriptEntries(html) {
  const entries = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (type !== "module" || !src || !src.startsWith("/src/")) continue;
    entries.push(src.slice(1));
  }
  return entries;
}

function modulePreloadHrefs(html) {
  const hrefs = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1];
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (rel !== "modulepreload" || !href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

async function browserJavaScriptGraph(entry, seen = new Set()) {
  const source = path.resolve(root, entry);
  if (seen.has(source)) return seen;
  assert.ok(source.startsWith(`${root}${path.sep}`), `Browser graph must stay inside project root: ${source}`);
  seen.add(source);

  const text = await readFile(source, "utf8");
  for (const imported of localJavaScriptImports(source, text)) {
    await browserJavaScriptGraph(path.relative(root, imported), seen);
  }

  return seen;
}

function distRelative(file) {
  return path.relative(path.join(root, "dist"), file).replaceAll(path.sep, "/");
}

async function distJavaScriptImportGraph(entry, cache = new Map()) {
  if (cache.has(entry)) return cache.get(entry);

  const distRoot = path.join(root, "dist");
  const source = path.resolve(distRoot, entry);
  assert.ok(source.startsWith(`${distRoot}${path.sep}`), `Dist module graph must stay inside dist: ${source}`);

  const seen = new Set([distRelative(source)]);
  const queue = [source];
  const graph = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const text = await readFile(current, "utf8");
    const imports = localJavaScriptImports(current, text)
      .map(imported => path.resolve(imported))
      .filter(imported => imported.startsWith(`${distRoot}${path.sep}`))
      .sort((a, b) => distRelative(a).localeCompare(distRelative(b)));

    for (const imported of imports) {
      const relative = distRelative(imported);
      if (seen.has(relative)) continue;
      seen.add(relative);
      graph.push(relative);
      queue.push(imported);
    }
  }

  cache.set(entry, graph);
  return graph;
}

async function assertSourceBrowserGraph() {
  const seen = new Set();
  for (const entry of browserScriptEntries) {
    await browserJavaScriptGraph(entry, seen);
  }

  const forbidden = [...seen]
    .map(file => path.relative(root, file))
    .filter(file => {
      const normalized = file.replaceAll(path.sep, "/");
      return /(?:^|-)benchmarks\.js$/i.test(path.basename(file))
        || /-benchmark\.js$/i.test(path.basename(file))
        || /^src\/intelligence\/[^/]+\/contract\.js$/i.test(normalized)
        || /^src\/intelligence\/json-transform\/translator-benchmarks\.js$/i.test(normalized);
    });

  assert.deepEqual(
    forbidden,
    [],
    `browser entry graph must not depend on benchmark or contract modules: ${forbidden.join(", ")}`
  );
}

async function assertDistVendor() {
  await assertFile("dist/assets/latentmachine-logo.png");
  await assertFile("dist/src/vendor/yaml/index.js");
  await assertFile("dist/src/vendor/yaml/dist/index.js");
  await assertFile("dist/src/intelligence/data-formats/yaml.js");

  const dataFormats = await import(pathToFileURL(path.join(root, "dist/src/intelligence/data-formats/index.js")).href);
  const serialized = dataFormats.serializeWithFormat({ person: "Tim", country: "NO" }, "yaml");
  assert.match(serialized, /person: Tim\ncountry: "NO"/);
  assert.deepEqual(dataFormats.parseWithFormat(serialized, "yaml"), { person: "Tim", country: "NO" });
}

async function assertDistFonts() {
  const fontDir = path.join(root, "dist", "fonts");
  const entries = await readdir(fontDir, { withFileTypes: true });
  const fonts = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  assert.deepEqual(fonts, [...expectedDistFonts].sort(), `dist/fonts must contain only referenced fonts: ${fonts.join(", ")}`);

  const references = new Set();
  for (const file of await findFiles(path.join(root, "dist"), name => /\.(?:html|css)$/i.test(name))) {
    const text = await readFile(path.join(root, "dist", file), "utf8");
    for (const match of text.matchAll(/(?:\/|\.\.\/\.\.\/)fonts\/([^"')\s]+)/g)) {
      references.add(match[1]);
    }
  }

  assert.deepEqual(
    [...references].sort(),
    fonts,
    `font references must match copied dist fonts: ${[...references].sort().join(", ")}`
  );
}

async function assertDistModulePreloads() {
  const cache = new Map();
  for (const file of await htmlFiles(path.join(root, "dist"))) {
    const html = await readFile(path.join(root, "dist", file), "utf8");
    const expected = new Set();
    for (const entry of moduleScriptEntries(html)) {
      for (const imported of await distJavaScriptImportGraph(entry, cache)) {
        expected.add(`/${imported}`);
      }
    }

    const actual = modulePreloadHrefs(html);
    assert.deepEqual(
      actual.sort(),
      [...expected].sort(),
      `${file} modulepreload links must match its transitive module imports`,
    );

    for (const href of actual) {
      assert.ok(href.startsWith("/src/"), `${file} modulepreload must point at local source modules: ${href}`);
      await assertFile(`dist/${href.slice(1)}`);
    }
  }
}

async function htmlFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await htmlFiles(absolute, base));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      files.push(path.relative(base, absolute));
    }
  }

  return files;
}

async function findFiles(dir, predicate, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findFiles(absolute, predicate, base));
      continue;
    }
    if (entry.isFile() && predicate(entry.name, absolute)) {
      files.push(path.relative(base, absolute));
    }
  }

  return files;
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

async function assertDistPublicArtifacts() {
  const forbidden = await findFiles(
    path.join(root, "dist"),
    (name, absolute) => {
      const relative = path.relative(path.join(root, "dist"), absolute).replaceAll(path.sep, "/");
      return /(?:^|-)benchmarks\.js$/i.test(name)
        || /-benchmark\.js$/i.test(name)
        || /^src\/intelligence\/json-transform\/translator-benchmarks\.js$/i.test(relative)
        || /^src\/intelligence\/[^/]+\/contract\.js$/i.test(relative)
        || /^src\/intelligence\/(?:arc|pattern-lab|tools)\//i.test(relative)
        || /^(?:docs|notes|fixtures|scripts|partials)\//i.test(relative)
        || /^(?:README|package|package-lock)\.json$/i.test(relative)
        || /^README\.md$/i.test(relative);
    }
  );

  assert.deepEqual(
    forbidden,
    [],
    `dist must not publish internal artifacts: ${forbidden.join(", ")}`
  );
}

async function distArtifactSummary() {
  const files = await findFiles(path.join(root, "dist"), () => true);
  const rows = await Promise.all(files.map(async file => {
    const buffer = await readFile(path.join(root, "dist", file));
    return {
      file: file.replaceAll(path.sep, "/"),
      bytes: buffer.length,
      gzipBytes: gzipSync(buffer).length,
      brotliBytes: brotliCompressSync(buffer, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    };
  }));

  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const totalGzipBytes = rows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const totalBrotliBytes = rows.reduce((sum, row) => sum + row.brotliBytes, 0);
  assert.ok(totalBytes <= artifactBudgets.rawBytes, `dist raw size ${totalBytes} exceeds ${artifactBudgets.rawBytes}`);
  assert.ok(totalGzipBytes <= artifactBudgets.gzipBytes, `dist gzip size ${totalGzipBytes} exceeds ${artifactBudgets.gzipBytes}`);
  assert.ok(totalBrotliBytes <= artifactBudgets.brotliBytes, `dist brotli size ${totalBrotliBytes} exceeds ${artifactBudgets.brotliBytes}`);

  return {
    files: rows.length,
    totalBytes,
    totalGzipBytes,
    totalBrotliBytes,
    budgets: artifactBudgets,
    largest: rows
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5),
    largestCompressed: [...rows]
      .sort((a, b) => b.gzipBytes - a.gzipBytes)
      .slice(0, 5)
      .map(row => ({ file: row.file, gzipBytes: row.gzipBytes, brotliBytes: row.brotliBytes })),
  };
}

async function assertDistSeo() {
  await assertFile("dist/robots.txt");
  await assertFile("dist/sitemap.xml");

  const robots = await readFile(path.join(root, "dist", "robots.txt"), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/latentmachine\.com\/sitemap\.xml$/m, "robots.txt must point at the canonical sitemap host");
  assert.doesNotMatch(robots, /https:\/\/www\.latentmachine\.com/i, "robots.txt must not advertise the www host");

  const sitemap = await readFile(path.join(root, "dist", "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.ok(locs.length > 0, "sitemap.xml must contain at least one URL");
  assert.ok(locs.includes(`${canonicalOrigin}/`), "sitemap.xml must include the canonical homepage URL with trailing slash");

  for (const loc of locs) {
    const url = new URL(loc);
    assert.equal(url.origin, canonicalOrigin, `sitemap URL must use ${canonicalOrigin}: ${loc}`);
    assert.doesNotMatch(url.pathname, /\/index\.html$/i, `sitemap URL must not expose index.html: ${loc}`);
  }

  for (const file of await htmlFiles(path.join(root, "dist"))) {
    const html = await readFile(path.join(root, "dist", file), "utf8");
    const robotsMeta = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1] || "";
    if (/\bnoindex\b/i.test(robotsMeta)) continue;

    const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
    assert.ok(canonical, `${file} must have a canonical URL`);

    const canonicalUrl = normalizeUrl(canonical);
    assert.equal(new URL(canonicalUrl).origin, canonicalOrigin, `${file} canonical must use ${canonicalOrigin}`);
    assert.ok(locs.includes(canonicalUrl), `${file} canonical URL must be present in sitemap.xml: ${canonicalUrl}`);
  }
}

async function assertDistChromePolish() {
  await assertFile("dist/assets/latentmachine-logo.png");

  const ogPngExists = await fileExists("dist/og.png");
  const toolPages = new Set(["infer.html", "verify.html", "regex.html", "jq.html"]);
  const htmlPageFiles = await htmlFiles(path.join(root, "dist"));

  for (const file of htmlPageFiles) {
    const normalized = file.replaceAll(path.sep, "/");
    const html = await readFile(path.join(root, "dist", file), "utf8");

    assert.ok(html.includes('<a href="#main-content" class="skip-link">Skip to content</a>'), `${normalized} must include the shared skip link`);
    assert.match(html, /\bid=["']main-content["']/, `${normalized} must expose #main-content`);
    assert.doesNotMatch(html, /\bid=["']content["']/, `${normalized} must not regress to the old #content anchor`);
    assert.ok(html.includes('<link rel="icon" href="/assets/latentmachine-logo.png" type="image/png" sizes="320x320" />'), `${normalized} must include the PNG favicon`);
    assert.ok(html.includes('<meta name="theme-color" content="#f4f4f2" media="(prefers-color-scheme: light)" />'), `${normalized} must include the light theme-color`);
    assert.ok(html.includes('<meta name="theme-color" content="#131314" media="(prefers-color-scheme: dark)" />'), `${normalized} must include the dark theme-color`);

    if (toolPages.has(normalized)) {
      assert.match(html, /<noscript>[\s\S]*needs JavaScript[\s\S]*Nothing is sent to a server/i, `${normalized} must explain the no-JavaScript state`);
    }

    if (ogPngExists) {
      assert.match(html, /<meta\s+property=["']og:image["']\s+content=["']https:\/\/latentmachine\.com\/og\.png["']/i, `${normalized} must advertise og.png when the asset exists`);
      assert.match(html, /<meta\s+name=["']twitter:image["']\s+content=["']https:\/\/latentmachine\.com\/og\.png["']/i, `${normalized} must advertise twitter:image when og.png exists`);
    } else {
      assert.doesNotMatch(html, /<(?:meta)\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i, `${normalized} must not advertise a missing social image`);
    }
  }

  const notFound = await readFile(path.join(root, "dist", "404.html"), "utf8");
  assert.match(notFound, /<meta\s+name=["']robots["']\s+content=["']noindex["']\s*\/?>/i, "404.html must stay noindex");
  assert.doesNotMatch(notFound, /<link\s+rel=["']canonical["']/i, "404.html must not publish a canonical URL");
}

async function assertDistLatentlogRelatedArticles() {
  const articleFiles = (await htmlFiles(path.join(root, "dist", "latentlog")))
    .map(file => file.replaceAll(path.sep, "/"))
    .filter(file => file !== "index.html");

  assert.ok(articleFiles.length > 0, "dist/latentlog must include article pages");

  for (const file of articleFiles) {
    const html = await readFile(path.join(root, "dist", "latentlog", file), "utf8");
    const slug = file.replace(/\.html$/i, "");
    const related = html.match(/<section aria-label=["']Related articles["']>([\s\S]*?)<\/section>/i)?.[1];

    assert.ok(html.includes('href="/verify">Check a batch &rarr;</a>'), `latentlog/${file} must include the Verify CTA`);
    assert.ok(related, `latentlog/${file} must include a related-articles section`);

    const relatedLinks = [...related.matchAll(/<a\s+class=["']article-item["']\s+href=["']\/latentlog\/([^"']+)["']/g)]
      .map(match => match[1]);

    assert.equal(relatedLinks.length, Math.min(3, articleFiles.length - 1), `latentlog/${file} must show deterministic related links`);
    assert.ok(!relatedLinks.includes(slug), `latentlog/${file} related links must not include itself`);
  }
}

const checks = [];
let artifactSummary = null;

try {
  await assertNoPackageDependency();
  checks.push("package metadata has no yaml dependency");
  await assertGitignoreKeepsVendorDistTrackable();
  checks.push(".gitignore keeps vendored dist trackable");

  if (mode === "source" || mode === "all") {
    await assertSourceVendor();
    checks.push("source vendored YAML files exist");
    await assertSourceBrowserGraph();
    checks.push("browser source graph excludes benchmark and contract modules");
  }

  if (mode === "dist" || mode === "all") {
    await exists("dist");
    await assertDistVendor();
    checks.push("built dist can import vendored YAML");
    await assertDistFonts();
    checks.push("built dist ships only referenced fonts");
    await assertDistModulePreloads();
    checks.push("built dist modulepreload links match page import graphs");
    await assertDistPublicArtifacts();
    checks.push("built dist excludes internal artifacts");
    await assertDistSeo();
    checks.push("built dist has canonical robots and sitemap URLs");
    await assertDistChromePolish();
    checks.push("built dist keeps shared chrome, no-JS, 404, and social-image contracts");
    await assertDistLatentlogRelatedArticles();
    checks.push("built Latentlog articles include Verify CTA and related links");
    artifactSummary = await distArtifactSummary();
    checks.push("built dist stays within raw and compressed size budgets");
  }

  console.log(JSON.stringify({ mode, passed: checks.length, checks, ...(artifactSummary ? { artifactSummary } : {}) }, null, 2));
} catch (error) {
  console.error(`Deploy preflight failed: ${error?.message || "Unknown error"}`);
  process.exit(1);
}
