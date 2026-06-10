"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toPrice,
  getField,
  fetchBinance,
  fetchPoloniex,
  fetchCloudflare,
  fetchSlowApi,
  fetchCoingecko,
  fetchCryptocompare,
} = require("../src/price-sources");

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/** Build a fetchImpl that returns a fixed body for any URL. */
function constantFetch(body) {
  return async () => jsonResponse(body);
}

/** Build a fetchImpl that returns different bodies based on URL substrings. */
function routedFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) {
        return jsonResponse(body);
      }
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test("toPrice accepts positive numbers and numeric strings", () => {
  assert.equal(toPrice(0.25, "x"), 0.25);
  assert.equal(toPrice("0.25", "x"), 0.25);
});

test("toPrice rejects non-positive, NaN, and missing values", () => {
  assert.throws(() => toPrice(0, "x"), /Invalid price/);
  assert.throws(() => toPrice(-1, "x"), /Invalid price/);
  assert.throws(() => toPrice("not-a-number", "x"), /Invalid price/);
  assert.throws(() => toPrice(undefined, "x"), /Invalid price/);
});

test("getField throws on a missing nested path", () => {
  assert.throws(
    () => getField({ a: {} }, ["a", "b", "c"], "src"),
    /missing "a\.b\.c"/,
  );
  assert.equal(getField({ a: { b: 1 } }, ["a", "b"], "src"), 1);
});

test("fetchCoingecko parses the nested USD price", async () => {
  const fetchImpl = constantFetch({ steem: { usd: 0.3 } });
  assert.equal(await fetchCoingecko({ fetchImpl }), 0.3);
});

test("fetchCoingecko rejects on an unexpected shape", async () => {
  const fetchImpl = constantFetch({ steem: {} });
  await assert.rejects(
    () => fetchCoingecko({ fetchImpl }),
    /missing "steem\.usd"/,
  );
});

test("fetchCryptocompare parses USDT and surfaces error envelopes", async () => {
  const ok = constantFetch({ USDT: 0.2 });
  assert.equal(await fetchCryptocompare({ fetchImpl: ok }), 0.2);

  const errored = constantFetch({ Response: "Error", Message: "rate limit" });
  await assert.rejects(
    () => fetchCryptocompare({ fetchImpl: errored }),
    /Cryptocompare error: rate limit/,
  );
});

test("fetchCryptocompare sends the API key as an Authorization header", async () => {
  let seenInit;
  const fetchImpl = async (url, init) => {
    seenInit = init;
    return jsonResponse({ USDT: 0.2 });
  };

  assert.equal(
    await fetchCryptocompare({ fetchImpl, apiKey: "test-key" }),
    0.2,
  );
  assert.equal(seenInit.headers.authorization, "Apikey test-key");
});

test("fetchCryptocompare omits the Authorization header without a key", async () => {
  const previous = process.env.CRYPTOCOMPARE_API_KEY;
  delete process.env.CRYPTOCOMPARE_API_KEY;

  try {
    let seenInit;
    const fetchImpl = async (url, init) => {
      seenInit = init;
      return jsonResponse({ USDT: 0.2 });
    };

    await fetchCryptocompare({ fetchImpl });
    assert.ok(!seenInit.headers || !seenInit.headers.authorization);
  } finally {
    if (previous !== undefined) {
      process.env.CRYPTOCOMPARE_API_KEY = previous;
    }
  }
});

test("fetchBinance multiplies BTC and STEEM/BTC prices", async () => {
  const fetchImpl = routedFetch([
    ["BTCUSDT", { price: "60000" }],
    ["STEEMBTC", { price: "0.000005" }],
  ]);
  const price = await fetchBinance({ fetchImpl });
  assert.ok(Math.abs(price - 0.3) < 1e-9);
});

test("fetchBinance rejects when a leg is missing a price", async () => {
  const fetchImpl = routedFetch([
    ["BTCUSDT", { price: "60000" }],
    ["STEEMBTC", {}],
  ]);
  await assert.rejects(() => fetchBinance({ fetchImpl }), /Invalid price/);
});

test("fetchPoloniex prefers the direct STEEM_USDT market", async () => {
  const fetchImpl = constantFetch([
    { symbol: "STEEM_USDT", price: "0.21" },
    { symbol: "STEEM_BTC", price: "0.000004" },
    { symbol: "BTC_USDT", price: "60000" },
  ]);
  assert.equal(await fetchPoloniex({ fetchImpl }), 0.21);
});

test("fetchPoloniex falls back to STEEM_BTC * BTC_USDT", async () => {
  const fetchImpl = constantFetch([
    { symbol: "STEEM_BTC", price: "0.000005" },
    { symbol: "BTC_USDT", price: "60000" },
  ]);
  const price = await fetchPoloniex({ fetchImpl });
  assert.ok(Math.abs(price - 0.3) < 1e-9);
});

test("fetchPoloniex rejects when no STEEM market is present", async () => {
  const fetchImpl = constantFetch([{ symbol: "BTC_USDT", price: "60000" }]);
  await assert.rejects(
    () => fetchPoloniex({ fetchImpl }),
    /no STEEM market found/,
  );
});

test("fetchPoloniex rejects when the payload is not an array", async () => {
  const fetchImpl = constantFetch({ error: "nope" });
  await assert.rejects(() => fetchPoloniex({ fetchImpl }), /expected an array/);
});

test("fetchCloudflare parses the price from the result string", async () => {
  const fetchImpl = constantFetch({ result: ["STEEM USDT = 0.25 USD"] });
  assert.equal(await fetchCloudflare({ fetchImpl }), 0.25);
});

test("fetchCloudflare rejects on a malformed result", async () => {
  const fetchImpl = constantFetch({ result: [] });
  await assert.rejects(
    () => fetchCloudflare({ fetchImpl }),
    /malformed result/,
  );
});

test("fetchSlowApi reads the regular market price", async () => {
  const fetchImpl = constantFetch({
    data: { "STEEM-USD": { regularMarketPrice: 0.27 } },
  });
  assert.equal(await fetchSlowApi({ fetchImpl }), 0.27);
});

test("fetchSlowApi rejects when the field is missing", async () => {
  const fetchImpl = constantFetch({ data: {} });
  await assert.rejects(() => fetchSlowApi({ fetchImpl }), /missing/);
});
