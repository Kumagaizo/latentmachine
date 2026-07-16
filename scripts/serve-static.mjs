import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedDir = process.argv[2] || ".";
const serveRoot = path.resolve(root, requestedDir);
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
};

function resolveRequest(url) {
  const pathname = decodeURIComponent(new URL(url, `http://127.0.0.1:${port}`).pathname);
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const candidates = [
    cleanPath,
    `${cleanPath}.html`,
    path.join(cleanPath, "index.html"),
  ];

  return candidates.map(candidate => path.resolve(serveRoot, `.${candidate}`));
}

function isInsideServeRoot(file) {
  return file === serveRoot || file.startsWith(`${serveRoot}${path.sep}`);
}

const server = createServer(async (request, response) => {
  for (const file of resolveRequest(request.url || "/")) {
    if (!isInsideServeRoot(file)) continue;

    try {
      const info = await stat(file);
      if (!info.isFile()) continue;

      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      createReadStream(file).pipe(response);
      return;
    } catch {}
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${path.relative(root, serveRoot) || "."} at http://127.0.0.1:${port}`);
});
