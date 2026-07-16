export const SHARE_HASH_LIMIT = 8000;

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function transformBytes(bytes, kind) {
  const Constructor = kind === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Constructor) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new Constructor("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShareState(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  try {
    const compressed = await transformBytes(bytes, "compress");
    if (compressed) return `d.${bytesToBase64(compressed)}`;
  } catch {}
  return `j.${bytesToBase64(bytes)}`;
}

export async function decodeShareState(encoded) {
  const [mode, payload] = String(encoded || "").split(/\.(.*)/s, 2);
  if (!payload || !["d", "j"].includes(mode)) throw new Error("This share link is not valid.");
  let bytes = base64ToBytes(payload);
  if (mode === "d") {
    const decompressed = await transformBytes(bytes, "decompress");
    if (!decompressed) throw new Error("This browser cannot open compressed share links.");
    bytes = decompressed;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function encodedStateFromHash(hash = globalThis.location?.hash || "") {
  return String(hash).startsWith("#s=") ? String(hash).slice(3) : null;
}

export async function sharedStateFromLocation(locationValue = globalThis.location) {
  const encoded = encodedStateFromHash(locationValue?.hash);
  return encoded ? decodeShareState(encoded) : null;
}

export async function shareUrlForState(value, locationValue = globalThis.location) {
  const encoded = await encodeShareState(value);
  const url = new URL(locationValue.href);
  url.hash = `s=${encoded}`;
  if (url.hash.length > SHARE_HASH_LIMIT) {
    throw new Error("This state is too large to share safely in a URL. Export a local file instead.");
  }
  return url.href;
}

export async function copyText(value) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(String(value));
      return true;
    }
  } catch {}
  if (!globalThis.document) return false;
  const field = document.createElement("textarea");
  field.value = String(value);
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  field.focus();
  field.select();
  try {
    return !!document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
