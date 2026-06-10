"use strict";

const { fetchJson } = require("./http");

/**
 * Coerce a raw API value into a validated, positive, finite price.
 *
 * @param {*} value - The raw price value from an API response.
 * @param {string} source - Human-readable source name (used in errors).
 * @returns {number} A finite price greater than zero.
 * @throws {Error} If the value cannot be parsed into a positive finite number.
 */
function toPrice(value, source) {
  const price = typeof value === "number" ? value : parseFloat(value);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price from ${source}: ${JSON.stringify(value)}`);
  }

  return price;
}

/**
 * Safely read a nested field, throwing a descriptive error when the response
 * does not have the expected shape.
 *
 * @param {object} object - The object to read from.
 * @param {string[]} pathParts - The path of keys to traverse.
 * @param {string} source - Human-readable source name (used in errors).
 * @returns {*} The value found at the given path.
 */
function getField(object, pathParts, source) {
  let current = object;

  for (const key of pathParts) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      throw new Error(
        `Unexpected response from ${source}: missing "${pathParts.join(".")}"`,
      );
    }
    current = current[key];
  }

  return current;
}

async function fetchCryptocompare(options = {}) {
  const { apiKey = process.env.CRYPTOCOMPARE_API_KEY, ...fetchOptions } =
    options;

  // Cryptocompare works without a key but is rate-limited. When a key is
  // configured (via the CRYPTOCOMPARE_API_KEY env var or an explicit option),
  // send it using the documented `Authorization: Apikey <key>` header.
  const requestOptions = apiKey
    ? {
        ...fetchOptions,
        headers: {
          ...(fetchOptions.headers || {}),
          authorization: `Apikey ${apiKey}`,
        },
      }
    : fetchOptions;

  const data = await fetchJson(
    "https://min-api.cryptocompare.com/data/price?fsym=STEEM&tsyms=USDT",
    requestOptions,
  );

  // Cryptocompare returns HTTP 200 with an error envelope on failure.
  if (data && data.Response === "Error") {
    throw new Error(`Cryptocompare error: ${data.Message}`);
  }

  return toPrice(data && data.USDT, "Cryptocompare");
}

async function fetchCoingecko(options) {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd",
    options,
  );

  return toPrice(getField(data, ["steem", "usd"], "Coingecko"), "Coingecko");
}

async function fetchBinance(options) {
  const btcData = await fetchJson(
    "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    options,
  );
  const steemData = await fetchJson(
    "https://api.binance.com/api/v3/ticker/price?symbol=STEEMBTC",
    options,
  );

  const btcUsd = toPrice(btcData && btcData.price, "Binance (BTCUSDT)");
  const steemBtc = toPrice(steemData && steemData.price, "Binance (STEEMBTC)");

  return toPrice(btcUsd * steemBtc, "Binance");
}

async function fetchPoloniex(options) {
  const data = await fetchJson(
    "https://api.poloniex.com/markets/price",
    options,
  );

  if (!Array.isArray(data)) {
    throw new Error("Unexpected response from Poloniex: expected an array");
  }

  const bySymbol = {};
  for (const entry of data) {
    if (entry && entry.symbol) {
      bySymbol[entry.symbol] = entry;
    }
  }

  const priceOf = (symbol) =>
    bySymbol[symbol] ? parseFloat(bySymbol[symbol].price) : NaN;

  let price;
  let path;

  if (bySymbol.STEEM_USDT) {
    price = priceOf("STEEM_USDT");
    path = "STEEM_USDT";
  } else if (bySymbol.STEEM_BTC && bySymbol.BTC_USDT) {
    price = priceOf("STEEM_BTC") * priceOf("BTC_USDT");
    path = "STEEM_BTC * BTC_USDT";
  } else if (bySymbol.STEEM_TRX && bySymbol.TRX_USDT) {
    price = priceOf("STEEM_TRX") * priceOf("TRX_USDT");
    path = "STEEM_TRX * TRX_USDT";
  } else {
    throw new Error("Unexpected response from Poloniex: no STEEM market found");
  }

  return toPrice(price, `Poloniex (${path})`);
}

async function fetchCloudflare(options) {
  const data = await fetchJson(
    "https://ticker.justyy.com/query/?s=STEEM+USDT",
    options,
  );

  const result = getField(data, ["result"], "Cloudflare");

  if (!Array.isArray(result) || typeof result[0] !== "string") {
    throw new Error("Unexpected response from Cloudflare: malformed result");
  }

  const parts = result[0].split(" ");
  return toPrice(parts[3], "Cloudflare");
}

async function fetchSlowApi(options) {
  const data = await fetchJson("https://uploadbeta.com/api/yf/", options);

  const price = getField(
    data,
    ["data", "STEEM-USD", "regularMarketPrice"],
    "SlowAPI",
  );

  return toPrice(price, "SlowAPI");
}

/**
 * Registry mapping configured exchange names to their fetcher functions.
 * Each fetcher takes `options` (forwarded to {@link fetchJson}) and resolves
 * to a validated price or rejects with a descriptive error.
 */
const SOURCES = {
  binance: fetchBinance,
  poloniex: fetchPoloniex,
  cloudflare: fetchCloudflare,
  slowapi: fetchSlowApi,
  coingecko: fetchCoingecko,
  cryptocompare: fetchCryptocompare,
};

module.exports = {
  SOURCES,
  toPrice,
  getField,
  fetchBinance,
  fetchPoloniex,
  fetchCloudflare,
  fetchSlowApi,
  fetchCoingecko,
  fetchCryptocompare,
};
