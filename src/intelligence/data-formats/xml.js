import { assertSafeObjectKey } from "./safety.js";

function normalizeLineEndings(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function xmlError(message, source = "", index = null) {
  if (!Number.isFinite(index)) return new Error(message);
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return new Error(`line ${line}, column ${column}: ${message}`);
}

function stripNamespace(name = "") {
  return String(name).replace(/^.*:/, "");
}

function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return match;
  });
}

function encodeText(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodeAttribute(text) {
  return encodeText(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findTagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function skipUntil(source, start, token) {
  const end = source.indexOf(token, start);
  if (end < 0) throw xmlError(`unterminated ${token === ">" ? "declaration" : "section"}.`, source, start);
  return end + token.length;
}

function parseTag(raw, source, offset) {
  const body = raw.trim();
  const nameMatch = body.match(/^([A-Za-z_][\w:.-]*)/);
  if (!nameMatch) throw xmlError("invalid tag name.", source, offset);
  const name = stripNamespace(nameMatch[1]);
  assertSafeObjectKey(name, "XML element");
  const attributes = {};
  let index = nameMatch[0].length;

  while (index < body.length) {
    while (/\s/.test(body[index])) index += 1;
    if (index >= body.length) break;
    const attrMatch = body.slice(index).match(/^([A-Za-z_][\w:.-]*)/);
    if (!attrMatch) throw xmlError("invalid attribute.", source, offset + index);
    const rawName = attrMatch[1];
    const attrName = stripNamespace(rawName);
    assertSafeObjectKey(attrName, "XML attribute");
    index += rawName.length;
    while (/\s/.test(body[index])) index += 1;

    let value = "";
    if (body[index] === "=") {
      index += 1;
      while (/\s/.test(body[index])) index += 1;
      const quote = body[index];
      if (quote === "\"" || quote === "'") {
        const close = body.indexOf(quote, index + 1);
        if (close < 0) throw xmlError(`unterminated attribute "${attrName}".`, source, offset + index);
        value = body.slice(index + 1, close);
        index = close + 1;
      } else {
        const nextSpace = body.slice(index).search(/\s/);
        const end = nextSpace < 0 ? body.length : index + nextSpace;
        value = body.slice(index, end);
        index = end;
      }
    }

    if (!rawName.startsWith("xmlns")) attributes[`@${attrName}`] = decodeEntities(value);
  }

  return { name, attributes };
}

function addChild(parent, name, value) {
  parent.children.push({ name, value });
}

function materialize(node) {
  const result = { ...node.attributes };
  const grouped = new Map();
  for (const child of node.children) {
    if (!grouped.has(child.name)) grouped.set(child.name, []);
    grouped.get(child.name).push(child.value);
  }
  for (const [name, values] of grouped) {
    result[name] = values.length === 1 ? values[0] : values;
  }

  const hasAttributes = Object.keys(node.attributes).length > 0;
  const hasChildren = node.children.length > 0;
  const text = node.text.join("");
  const hasText = text.trim() !== "";

  if (!hasAttributes && !hasChildren) return hasText ? text.trim() : null;
  if (hasText) result["#text"] = hasChildren ? text : text.trim();
  return result;
}

export function parseXML(text) {
  if (typeof text !== "string") throw xmlError("input must be a string.");
  const source = normalizeLineEndings(text);
  if (!source.trim()) throw xmlError("input is empty.");

  const root = { name: null, attributes: {}, children: [], text: [] };
  const stack = [root];
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("<", index);
    const textEnd = open < 0 ? source.length : open;
    const chunk = source.slice(index, textEnd);
    if (chunk.trim()) stack.at(-1).text.push(decodeEntities(chunk));
    if (open < 0) break;

    if (source.startsWith("<!--", open)) {
      index = skipUntil(source, open + 4, "-->");
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const close = source.indexOf("]]>", open + 9);
      if (close < 0) throw xmlError("unterminated CDATA section.", source, open);
      stack.at(-1).text.push(source.slice(open + 9, close));
      index = close + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      index = skipUntil(source, open + 2, "?>");
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(source.slice(open))) {
      index = skipUntil(source, open + 9, ">");
      continue;
    }
    if (source.startsWith("</", open)) {
      const close = source.indexOf(">", open + 2);
      if (close < 0) throw xmlError("unterminated closing tag.", source, open);
      const name = stripNamespace(source.slice(open + 2, close).trim());
      const node = stack.pop();
      if (!node || !node.name) throw xmlError(`unexpected closing tag </${name}>.`, source, open);
      if (node.name !== name) throw xmlError(`expected </${node.name}> but found </${name}>.`, source, open);
      addChild(stack.at(-1), node.name, materialize(node));
      index = close + 1;
      continue;
    }

    const close = findTagEnd(source, open + 1);
    if (close < 0) throw xmlError("unterminated opening tag.", source, open);
    const selfClosing = /\/\s*$/.test(source.slice(open + 1, close));
    const rawTag = source.slice(open + 1, close).replace(/\/\s*$/, "");
    const tag = parseTag(rawTag, source, open + 1);
    const node = { name: tag.name, attributes: tag.attributes, children: [], text: [] };
    if (selfClosing) addChild(stack.at(-1), node.name, materialize(node));
    else stack.push(node);
    index = close + 1;
  }

  if (stack.length > 1) {
    const node = stack.at(-1);
    throw xmlError(`unclosed tag <${node.name}>.`, source, source.length);
  }
  if (!root.children.length) throw xmlError("no root element found.");
  const result = {};
  for (const child of root.children) {
    if (Object.prototype.hasOwnProperty.call(result, child.name)) {
      result[child.name] = Array.isArray(result[child.name]) ? [...result[child.name], child.value] : [result[child.name], child.value];
    } else {
      result[child.name] = child.value;
    }
  }
  return result;
}

export function detectXML(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const source = normalizeLineEndings(text).trim();
  return /^<\?xml\b/i.test(source) || /^<[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(source);
}

function xmlName(name, fallback = "item") {
  const clean = stripNamespace(String(name ?? "")).replace(/^@|^#/, "");
  assertSafeObjectKey(clean, "XML output");
  return /^[A-Za-z_][\w.-]*$/.test(clean) ? clean : fallback;
}

function serializeElement(name, value, level, indentText) {
  const tag = xmlName(name);
  const indent = indentText.repeat(level);
  if (value === null || value === undefined) return `${indent}<${tag}/>`;
  if (typeof value !== "object" || Array.isArray(value)) {
    return `${indent}<${tag}>${encodeText(value)}</${tag}>`;
  }

  const attributes = [];
  const children = [];
  let text = "";
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("@")) {
      attributes.push(`${xmlName(key.slice(1), "attr")}="${encodeAttribute(item)}"`);
    } else if (key === "#text") {
      text = String(item ?? "");
    } else {
      children.push([key, item]);
    }
  }

  const attrs = attributes.length ? ` ${attributes.join(" ")}` : "";
  if (!children.length && !text) return `${indent}<${tag}${attrs}/>`;
  if (!children.length) return `${indent}<${tag}${attrs}>${encodeText(text)}</${tag}>`;

  const childLines = children.flatMap(([key, item]) => {
    const values = Array.isArray(item) ? item : [item];
    return values.map(value => serializeElement(key, value, level + 1, indentText));
  });
  const textLine = text ? [`${indentText.repeat(level + 1)}${encodeText(text)}`] : [];
  return `${indent}<${tag}${attrs}>\n${[...textLine, ...childLines].join("\n")}\n${indent}</${tag}>`;
}

export function serializeXML(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw xmlError("XML output must be an object.");
  const keys = Object.keys(value);
  if (!keys.length) throw xmlError("XML output must contain at least one root element.");
  const rootName = options.rootName || (keys.length === 1 ? keys[0] : "root");
  const rootValue = keys.length === 1 && !options.rootName ? value[rootName] : value;
  const declaration = options.declaration === false ? "" : "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
  return `${declaration}${serializeElement(rootName, rootValue, 0, options.indent || "  ")}\n`;
}

export const xmlFormat = {
  id: "xml",
  label: "XML",
  fileExtension: "xml",
  mimeType: "application/xml",
  detect: detectXML,
  parse: parseXML,
  serialize: serializeXML,
};
