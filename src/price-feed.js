"use strict";

const { SOURCES } = require("./price-sources");

/**
 * Resolve after the given number of milliseconds.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke an async function, retrying on failure with a fixed delay.
 *
 * @param {Function} fn - The async function to call.
 * @param {object} [options]
 * @param {number} [options.retries=0] - Maximum number of retries.
 * @param {number} [options.delayMs=0] - Delay between attempts, in ms.
 * @param {Function} [options.onRetry] - Called as (error, attempt) before each retry.
 * @param {Function} [options.sleep=defaultSleep] - Injectable sleep (testing).
 * @returns {Promise<*>} The resolved value of `fn`.
 */
async function fetchWithRetry(fn, options = {}) {
  const { retries = 0, delayMs = 0, onRetry, sleep = defaultSleep } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      attempt += 1;
      if (onRetry) {
        onRetry(err, attempt);
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}

/**
 * Compute the average of valid (finite, positive) prices.
 *
 * @param {number[]} prices - Candidate prices.
 * @returns {number} The average, or `NaN` if there are no valid prices.
 */
function average(prices) {
  const valid = (prices || []).filter((p) => Number.isFinite(p) && p > 0);

  if (valid.length === 0) {
    return NaN;
  }

  return valid.reduce((sum, p) => sum + p, 0) / valid.length;
}

/**
 * Build a Steem `feed_publish` exchange rate object from a price.
 *
 * @param {number} price - The STEEM price in USD/SBD.
 * @param {number} [pegMulti=1] - Feed bias; quote becomes `1 / pegMulti`.
 * @returns {{base: string, quote: string}} The exchange rate.
 * @throws {Error} If `price` is not a positive finite number.
 */
function buildExchangeRate(price, pegMulti = 1) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Cannot build exchange rate from invalid price: ${price}`);
  }

  const multiplier = Number.isFinite(pegMulti) && pegMulti > 0 ? pegMulti : 1;

  return {
    base: price.toFixed(3) + " SBD",
    quote: (1 / multiplier).toFixed(3) + " STEEM",
  };
}

/**
 * Fetch prices from all enabled exchanges concurrently.
 *
 * Unknown exchanges are skipped with a warning, and individual source failures
 * are logged but never reject the whole batch — the caller receives whatever
 * prices were successfully retrieved.
 *
 * @param {string[]} exchanges - Names of exchanges to query.
 * @param {object} [options]
 * @param {object} [options.sources=SOURCES] - Registry of source fetchers (testing).
 * @param {Function} [options.log] - Logger function.
 * @param {number} [options.timeout] - Per-request timeout in ms.
 * @param {number} [options.maxRetries=0] - Retries per source on failure.
 * @param {number} [options.retryInterval=0] - Delay between retries, in ms.
 * @param {Function} [options.sleep] - Injectable sleep (testing).
 * @returns {Promise<number[]>} The successfully fetched prices.
 */
async function collectPrices(exchanges, options = {}) {
  const {
    sources = SOURCES,
    log = () => {},
    timeout,
    maxRetries = 0,
    retryInterval = 0,
    sleep,
  } = options;

  const enabled = (Array.isArray(exchanges) ? exchanges : []).filter((name) => {
    if (typeof sources[name] !== "function") {
      log(`Skipping unknown exchange: ${name}`);
      return false;
    }
    return true;
  });

  const settled = await Promise.allSettled(
    enabled.map((name) =>
      fetchWithRetry(() => sources[name]({ timeout }), {
        retries: maxRetries,
        delayMs: retryInterval,
        sleep,
        onRetry: (err, attempt) =>
          log(`Retry ${attempt} loading price from ${name}: ${err.message}`),
      }).then((price) => {
        log(`Loaded STEEM price from ${name}: ${price}`);
        return price;
      }),
    ),
  );

  const prices = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      prices.push(result.value);
    } else {
      log(
        `Error loading STEEM price from ${enabled[index]}: ${result.reason.message}`,
      );
    }
  });

  return prices;
}

module.exports = {
  average,
  buildExchangeRate,
  collectPrices,
  fetchWithRetry,
  defaultSleep,
};
