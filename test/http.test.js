"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchJson } = require("../src/http");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test("fetchJson resolves with the parsed JSON body", async () => {
  const fetchImpl = async () => jsonResponse({ price: "1.23" });
  const data = await fetchJson("https://example.com", { fetchImpl });
  assert.deepEqual(data, { price: "1.23" });
});

test("fetchJson rejects on a non-2xx status", async () => {
  const fetchImpl = async () => jsonResponse({}, { ok: false, status: 503 });
  await assert.rejects(
    () => fetchJson("https://example.com", { fetchImpl }),
    /HTTP 503/,
  );
});

test("fetchJson rejects when the body is not valid JSON", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("Unexpected token");
    },
  });
  await assert.rejects(
    () => fetchJson("https://example.com", { fetchImpl }),
    /Failed to parse JSON/,
  );
});

test("fetchJson maps network failures to a descriptive error", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () => fetchJson("https://example.com", { fetchImpl }),
    /failed: ECONNREFUSED/,
  );
});

test("fetchJson aborts and reports a timeout", async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  await assert.rejects(
    () => fetchJson("https://example.com", { fetchImpl, timeout: 10 }),
    /timed out after 10ms/,
  );
});

test("fetchJson throws when no fetch implementation is available", async () => {
  await assert.rejects(
    () => fetchJson("https://example.com", { fetchImpl: null }),
    /Node\.js 18\+ is required/,
  );
});
