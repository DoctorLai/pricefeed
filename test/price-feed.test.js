"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  average,
  buildExchangeRate,
  collectPrices,
  fetchWithRetry,
} = require("../src/price-feed");

const noSleep = async () => {};

test("average ignores invalid values", () => {
  assert.ok(Math.abs(average([0.2, 0.4]) - 0.3) < 1e-9);
  assert.ok(Math.abs(average([0.2, NaN, 0.4, -1, 0]) - 0.3) < 1e-9);
});

test("average returns NaN when there are no valid prices", () => {
  assert.ok(Number.isNaN(average([])));
  assert.ok(Number.isNaN(average([NaN, -1, 0])));
});

test("buildExchangeRate formats base and quote", () => {
  assert.deepEqual(buildExchangeRate(0.3, 1), {
    base: "0.300 SBD",
    quote: "1.000 STEEM",
  });
});

test("buildExchangeRate applies the peg multiplier to the quote", () => {
  assert.deepEqual(buildExchangeRate(0.5, 2), {
    base: "0.500 SBD",
    quote: "0.500 STEEM",
  });
});

test("buildExchangeRate defaults an invalid peg to 1", () => {
  assert.deepEqual(buildExchangeRate(0.5, 0), {
    base: "0.500 SBD",
    quote: "1.000 STEEM",
  });
});

test("buildExchangeRate throws on an invalid price", () => {
  assert.throws(() => buildExchangeRate(NaN), /invalid price/);
  assert.throws(() => buildExchangeRate(0), /invalid price/);
});

test("fetchWithRetry returns immediately on success", async () => {
  let calls = 0;
  const result = await fetchWithRetry(async () => {
    calls += 1;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("fetchWithRetry retries until it succeeds", async () => {
  let calls = 0;
  const retries = [];
  const result = await fetchWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return "ok";
    },
    { retries: 5, sleep: noSleep, onRetry: (err, n) => retries.push(n) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("fetchWithRetry throws after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchWithRetry(
        async () => {
          calls += 1;
          throw new Error("always");
        },
        { retries: 2, sleep: noSleep },
      ),
    /always/,
  );
  assert.equal(calls, 3); // initial attempt + 2 retries
});

test("collectPrices returns only the prices that resolved", async () => {
  const logs = [];
  const sources = {
    good: async () => 0.2,
    bad: async () => {
      throw new Error("boom");
    },
  };

  const prices = await collectPrices(["good", "bad"], {
    sources,
    log: (msg) => logs.push(msg),
    sleep: noSleep,
  });

  assert.deepEqual(prices, [0.2]);
  assert.ok(logs.some((m) => m.includes("Error loading STEEM price from bad")));
});

test("collectPrices skips unknown exchanges with a warning", async () => {
  const logs = [];
  const sources = { good: async () => 0.2 };

  const prices = await collectPrices(["good", "mystery"], {
    sources,
    log: (msg) => logs.push(msg),
    sleep: noSleep,
  });

  assert.deepEqual(prices, [0.2]);
  assert.ok(logs.some((m) => m.includes("Skipping unknown exchange: mystery")));
});

test("collectPrices retries failing sources before giving up", async () => {
  let attempts = 0;
  const sources = {
    flaky: async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("temporary");
      }
      return 0.5;
    },
  };

  const prices = await collectPrices(["flaky"], {
    sources,
    maxRetries: 3,
    retryInterval: 1,
    sleep: noSleep,
  });

  assert.deepEqual(prices, [0.5]);
  assert.equal(attempts, 2);
});

test("collectPrices returns an empty array when every source fails", async () => {
  const sources = {
    bad: async () => {
      throw new Error("down");
    },
  };

  const prices = await collectPrices(["bad"], { sources, sleep: noSleep });
  assert.deepEqual(prices, []);
});

test("collectPrices handles a non-array exchange list", async () => {
  const prices = await collectPrices(undefined, { sources: {} });
  assert.deepEqual(prices, []);
});
