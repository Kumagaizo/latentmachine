import { readFile } from "node:fs/promises";
import path from "node:path";

const PARTIAL_NAMES = ["head-commons", "nav", "footer"];

export async function loadHtmlPartials(root) {
  return new Map(await Promise.all(
    PARTIAL_NAMES.map(async name => {
      const source = path.join(root, "partials", `${name}.html`);
      try {
        return [name, await readFile(source, "utf8")];
      } catch {
        throw new Error(`Missing partial: partials/${name}.html`);
      }
    }),
  ));
}

export function injectHtmlPartials(text, source, root, partials) {
  return text.replace(/<!--@partial:([a-z-]+)-->/g, (token, name) => {
    if (!partials.has(name)) {
      throw new Error(`${path.relative(root, source)} references missing partial token: ${token}`);
    }
    return partials.get(name);
  });
}
