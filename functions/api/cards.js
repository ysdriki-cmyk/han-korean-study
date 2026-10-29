// Optional Cloudflare Pages adapter. The static app also works without this API.
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

function reply(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function sourceURL(value) {
  const url = new URL(value);
  const validPath = /^\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]+\/(?:pub|export)$/.test(url.pathname);
  const csv = url.searchParams.get("output") === "csv" || url.searchParams.get("format") === "csv";
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password || !validPath || !csv) {
    throw new Error("Invalid sheet source");
  }
  return url;
}

function safeRedirect(url) {
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    (url.hostname === "docs.google.com" || url.hostname.endsWith(".googleusercontent.com"));
}

async function readLimitedBody(response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function proxySheetCSV(request, source) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return reply(JSON.stringify({ error: "このAPIは読み取り専用です。" }), 405, { Allow: "GET, HEAD" });
  }
  if (!source) return reply(JSON.stringify({ error: "スプレッドシートの接続先が未設定です。" }), 503);

  let url;
  try {
    url = sourceURL(source);
  } catch {
    return reply(JSON.stringify({ error: "公開CSV URLの設定を確認してください。" }), 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    for (let redirects = 0; redirects <= 4; redirects++) {
      response = await fetch(url.href, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "text/csv, text/plain;q=0.9" }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 4) throw new Error("Redirect failed");
      url = new URL(location, url);
      if (!safeRedirect(url)) throw new Error("Untrusted redirect");
    }
    if (!response.ok || /text\/html/i.test(response.headers.get("content-type") || "")) throw new Error("Not a CSV response");
    const csv = await readLimitedBody(response);
    if (!csv.trim() || /^\s*(?:<!doctype|<html)/i.test(csv)) throw new Error("Empty or HTML response");
    return reply(request.method === "HEAD" ? null : csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "X-Data-Source": "google-sheets"
    });
  } catch {
    return reply(JSON.stringify({ error: controller.signal.aborted ? "取得がタイムアウトしました。" : "スプレッドシートを取得できませんでした。" }), 502);
  } finally {
    clearTimeout(timer);
  }
}

export function onRequest({ request, env }) {
  return proxySheetCSV(request, env?.SHEET_CSV_URL);
}
