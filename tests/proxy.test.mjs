import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/cards.js";

const source = "https://docs.google.com/spreadsheets/d/e/example/pub?gid=0&output=csv";
const context = (env = { SHEET_CSV_URL: source }, method = "GET") => ({
  request: new Request("https://example.test/api/cards?url=https://attacker.test", { method }), env
});

test("proxy rejects writes and missing or unsafe configuration before network access", async () => {
  assert.equal((await onRequest(context({}, "POST"))).status, 405);
  assert.equal((await onRequest(context({}))).status, 503);
  for (const bad of ["https://attacker.test/pub?output=csv", "http://docs.google.com/spreadsheets/d/e/example/pub?output=csv", "https://docs.google.com/spreadsheets/d/e/example/pub?output=html", "https://name:secret@docs.google.com/spreadsheets/d/e/example/pub?output=csv"]) {
    assert.equal((await onRequest(context({ SHEET_CSV_URL: bad }))).status, 503);
  }
});

test("proxy fetches only configured sheet, follows safe redirects, and disables caching", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://doc-1.googleusercontent.com/export/example" } });
    return new Response("No.,Han,漢字\n1,가,家", { headers: { "Content-Type": "text/csv" } });
  });
  const response = await onRequest(context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls[0].url, source);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.cache, "no-store");
  assert.match(await response.text(), /가,家/);
});

test("proxy blocks redirects outside trusted Google hosts", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "https://googleusercontent.com.attacker.test/secret" } });
  });
  assert.equal((await onRequest(context())).status, 502);
  assert.equal(calls, 1);
});

test("proxy rejects HTML login/error pages and oversized CSV", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
  assert.equal((await onRequest(context())).status, 502);
  globalThis.fetch = async () => new Response("Han,漢字", { headers: { "Content-Length": String(4 * 1024 * 1024) } });
  assert.equal((await onRequest(context())).status, 502);
});
