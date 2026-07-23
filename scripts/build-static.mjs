import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");

const files = [
  "index.html",
  "infer.html",
  "verify.html",
  "regex.html",
  "jq.html",
  "trace.html",
  "about.html",
  "case-study.html",
  "developers.html",
  "legal.html",
  "privacy.html",
  "404.html",
  "assets/LM-Logo.png",
  "assets/og/og-image.svg",
  "fonts/StackSansText-VariableFont_wght.ttf",
  "fonts/MartianMono-VariableFont_wdth,wght.ttf",
  "src/local/styles.css",
];

const directories = [];

const scriptEntries = [
  "src/local/app.js",
  "src/local/verify.js",
  "src/local/regex.js",
  "src/local/jq.js",
  "src/local/trace.js",
  "src/local/trace-worker.js",
  "src/local/landing-demo.js",
  "src/local/chrome.js",
];

const partials = new Map();
const importGraphCache = new Map();

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to write outside project root: ${resolved}`);
  }
  return resolved;
}

async function copyFile(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const extension = path.extname(source).toLowerCase();
  const text = await readFile(source, extension === ".html" || extension === ".css" ? "utf8" : undefined);
  const output = extension === ".html"
    ? await renderHtml(text, source)
    : extension === ".css"
      ? minifyCss(text)
      : text;
  await writeFile(destination, output);
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(from, to);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
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

function rootRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
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

async function transitiveJavaScriptImports(entry) {
  if (importGraphCache.has(entry)) return importGraphCache.get(entry);

  const source = path.resolve(root, entry);
  if (!source.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to read outside project root: ${source}`);
  }

  const seen = new Set([rootRelative(source)]);
  const queue = [source];
  const graph = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const text = await readFile(current, "utf8");
    const imports = localJavaScriptImports(current, text)
      .map(imported => path.resolve(imported))
      .filter(imported => imported.startsWith(`${root}${path.sep}`))
      .sort((a, b) => rootRelative(a).localeCompare(rootRelative(b)));

    for (const imported of imports) {
      const relative = rootRelative(imported);
      if (seen.has(relative)) continue;
      seen.add(relative);
      graph.push(relative);
      queue.push(imported);
    }
  }

  importGraphCache.set(entry, graph);
  return graph;
}

async function copyJavaScriptGraph(entry, seen = new Set()) {
  const source = path.resolve(root, entry);
  if (seen.has(source)) return;
  seen.add(source);

  if (!source.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to read outside project root: ${source}`);
  }

  const text = await readFile(source, "utf8");
  await copyFile(source, path.join(outDir, path.relative(root, source)));

  for (const imported of localJavaScriptImports(source, text)) {
    await copyJavaScriptGraph(path.relative(root, imported), seen);
  }
}

async function loadPartials() {
  for (const name of ["head-commons", "nav", "footer"]) {
    const source = path.join(root, "partials", `${name}.html`);
    try {
      partials.set(name, await readFile(source, "utf8"));
    } catch {
      throw new Error(`Missing partial: partials/${name}.html`);
    }
  }
}

function injectPartials(text, source) {
  return text.replace(/<!--@partial:([a-z-]+)-->/g, (token, name) => {
    if (!partials.has(name)) {
      throw new Error(`${path.relative(root, source)} references missing partial token: ${token}`);
    }
    return partials.get(name);
  });
}

async function renderHtml(text, source) {
  const html = injectPartials(text, source);
  const scripts = moduleScriptEntries(html);
  if (!scripts.length) return html;

  const preloadSet = new Set();
  for (const script of scripts) {
    for (const imported of await transitiveJavaScriptImports(script)) {
      preloadSet.add(imported);
    }
  }

  const preloads = [...preloadSet].sort((a, b) => a.localeCompare(b));
  if (!preloads.length) return html;

  const links = preloads
    .map(file => `<link rel="modulepreload" href="/${file}" />`)
    .join("\n");

  return html.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']\/src\/local\/styles\.css["']\s*\/?>/i,
    match => `${match}\n${links}`,
  );
}

function preserveCssStrings(text) {
  const strings = [];
  let output = "";
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char !== "\"" && char !== "'") {
      output += char;
      index += 1;
      continue;
    }

    const quote = char;
    let token = char;
    index += 1;
    while (index < text.length) {
      const next = text[index];
      token += next;
      index += 1;
      if (next === "\\") {
        token += text[index] || "";
        index += 1;
        continue;
      }
      if (next === quote) break;
    }

    const placeholder = `___CSS_STRING_${strings.length}___`;
    strings.push(token);
    output += placeholder;
  }

  return { text: output, strings };
}

function restoreCssStrings(text, strings) {
  return text.replace(/___CSS_STRING_(\d+)___/g, (_, index) => strings[Number(index)] || "");
}

function minifyCss(text) {
  const preserved = preserveCssStrings(text);
  const minified = preserved.text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();

  return `${restoreCssStrings(minified, preserved.strings)}\n`;
}

await rm(assertInsideRoot(outDir), { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await loadPartials();

for (const file of files) {
  const source = path.join(root, file);
  if (!(await stat(source)).isFile()) throw new Error(`Missing deploy file: ${file}`);
  await copyFile(source, path.join(outDir, file));
}

for (const directory of directories) {
  const source = path.join(root, directory);
  if (!(await stat(source)).isDirectory()) throw new Error(`Missing deploy directory: ${directory}`);
  await copyDirectory(source, path.join(outDir, directory));
}

for (const entry of scriptEntries) {
  await copyJavaScriptGraph(entry);
}

const buildArticles = await import("./build-articles.mjs");
await buildArticles.build(root, outDir);

const buildSitemap = await import("./build-sitemap.mjs");
await buildSitemap.build(root, outDir);

console.log(`Built static site in ${path.relative(root, outDir)}`);
