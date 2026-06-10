"use strict";

const steem = require("steem");

const { log } = require("./src/logger");
const { loadConfig } = require("./src/config-loader");
const {
  collectPrices,
  average,
  buildExchangeRate,
} = require("./src/price-feed");

const DEFAULTS = {
  interval: 15,
  feed_publish_fail_retry: 5,
  price_feed_max_retry: 5,
  retry_interval: 10,
  peg_multi: 1,
  request_timeout: 20000,
};

const config = loadConfig();

/**
 * Resolve a setting from the config file first, then the environment, then a
 * provided fallback.
 */
function getSetting(name, fallback) {
  if (typeof config[name] !== "undefined" && config[name] !== "") {
    return config[name];
  }

  if (typeof process.env[name] !== "undefined" && process.env[name] !== "") {
    return process.env[name];
  }

  return fallback;
}

/**
 * Resolve a positive numeric setting, falling back to the documented default.
 */
function getNumber(name) {
  const value = Number(config[name]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULTS[name];
}

function getActiveKey() {
  return getSetting("feed_steem_active_key");
}

function getAccountName() {
  return getSetting("feed_steem_account");
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

log(__filename);
log(config.rpc_nodes || []);

if (!Array.isArray(config.rpc_nodes) || config.rpc_nodes.length < 3) {
  log("Please provide at least three rpc_nodes in config.yaml/config.json");
  process.exit(1);
}

if (!getAccountName()) {
  log("feed_steem_account not set in config.yaml/config.json or environment");
  process.exit(1);
}

if (!getActiveKey()) {
  log(
    "feed_steem_active_key not set in config.yaml/config.json or environment",
  );
  process.exit(1);
}

if (!Array.isArray(config.exchanges) || config.exchanges.length === 0) {
  log("No exchanges are specified.");
  process.exit(1);
}

const firstNode = config.rpc_nodes[0] || "https://api.steemit.com";
steem.api.setOptions({ transport: "https", uri: firstNode, url: firstNode });

/**
 * Switch the active RPC node to the next one in the configured list.
 */
function failover() {
  if (!Array.isArray(config.rpc_nodes) || config.rpc_nodes.length <= 1) {
    return;
  }

  let nextIndex = config.rpc_nodes.indexOf(steem.api.options.url) + 1;
  if (nextIndex >= config.rpc_nodes.length) {
    nextIndex = 0;
  }

  const nextNode = config.rpc_nodes[nextIndex];
  steem.api.setOptions({ transport: "https", uri: nextNode, url: nextNode });

  log("***********************************************");
  log("Failing over to: " + nextNode);
  log("***********************************************");
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Broadcast a single `feed_publish` transaction, retrying (and failing over
 * RPC nodes) on error.
 *
 * @param {number} price - The price to publish.
 * @param {number} [retries=0] - Internal retry counter.
 */
function publishFeed(price, retries = 0) {
  let exchangeRate;
  try {
    exchangeRate = buildExchangeRate(price, getNumber("peg_multi"));
  } catch (err) {
    log("Refusing to publish: " + err.message);
    return;
  }

  log("Broadcasting feed_publish transaction: " + JSON.stringify(exchangeRate));

  steem.broadcast.feedPublish(
    getActiveKey(),
    getAccountName(),
    exchangeRate,
    function (err, result) {
      if (result && !err) {
        log("Broadcast successful!");
        return;
      }

      log("Error broadcasting feed_publish transaction: " + err);

      const failRetry = getNumber("feed_publish_fail_retry");
      if (retries > 0 && retries % failRetry === 0) {
        failover();
      }

      setTimeout(
        () => publishFeed(price, retries + 1),
        getNumber("retry_interval") * 1000,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Fetch prices from all configured exchanges, average them, and publish.
 */
async function runOnce() {
  const prices = await collectPrices(config.exchanges, {
    log,
    timeout: getNumber("request_timeout"),
    maxRetries: getNumber("price_feed_max_retry"),
    retryInterval: getNumber("retry_interval") * 1000,
  });

  if (prices.length === 0) {
    log("No prices found.");
    return;
  }

  const price = average(prices);

  if (!Number.isFinite(price) || price <= 0) {
    log("No valid prices found.");
    return;
  }

  log("Price candidates: " + JSON.stringify(prices));
  log("Price = " + price);
  publishFeed(price, 0);
}

function startProcess() {
  runOnce().catch((err) => log("Unexpected error in price feed run: " + err));
}

setInterval(startProcess, getNumber("interval") * 60 * 1000);
startProcess();
