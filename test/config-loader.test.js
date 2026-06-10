"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadConfig,
  replaceEnvPlaceholders,
  replacePlaceholdersInObject,
} = require("../src/config-loader");

const FIXTURES = path.join(__dirname, "fixtures");

test("replaceEnvPlaceholders uses environment variables and fallbacks", () => {
  assert.equal(
    replaceEnvPlaceholders("${FEED_STEEM_ACTIVE_KEY:-secret}", {}),
    "secret",
  );
  assert.equal(
    replaceEnvPlaceholders("${FEED_STEEM_ACTIVE_KEY}", {
      FEED_STEEM_ACTIVE_KEY: "abc",
    }),
    "abc",
  );
});

test("replaceEnvPlaceholders resolves an empty default to an empty string", () => {
  // Regression: `${VAR:-}` with an unset VAR must become "" rather than the
  // literal placeholder, otherwise the placeholder leaks into the active key.
  assert.equal(replaceEnvPlaceholders("${FEED_STEEM_ACTIVE_KEY:-}", {}), "");
});

test("replaceEnvPlaceholders keeps the literal when no default is given", () => {
  assert.equal(replaceEnvPlaceholders("${MISSING_VAR}", {}), "${MISSING_VAR}");
});

test("replaceEnvPlaceholders prefers env over an empty value", () => {
  assert.equal(
    replaceEnvPlaceholders("${VAR:-fallback}", { VAR: "" }),
    "fallback",
  );
  assert.equal(
    replaceEnvPlaceholders("${VAR:-fallback}", { VAR: "value" }),
    "value",
  );
});

test("replaceEnvPlaceholders leaves non-string values untouched", () => {
  assert.equal(replaceEnvPlaceholders(42, {}), 42);
  assert.equal(replaceEnvPlaceholders(true, {}), true);
  assert.equal(replaceEnvPlaceholders(null, {}), null);
});

test("replacePlaceholdersInObject recurses through arrays and objects", () => {
  const input = {
    account: "${ACCOUNT:-default}",
    nodes: ["${NODE_A:-a}", "${NODE_B:-b}"],
    nested: { key: "${KEY}" },
  };

  const result = replacePlaceholdersInObject(input, {
    ACCOUNT: "matt",
    NODE_A: "node-a",
    KEY: "resolved",
  });

  assert.deepEqual(result, {
    account: "matt",
    nodes: ["node-a", "b"],
    nested: { key: "resolved" },
  });
});

test("loadConfig merges local YAML over global config and resolves env placeholders", () => {
  const config = loadConfig({
    cwd: __dirname,
    localPaths: [path.join(FIXTURES, "local.yaml")],
    globalPaths: [path.join(FIXTURES, "global.yaml")],
    env: { FEED_STEEM_ACCOUNT: "tester", FEED_STEEM_ACTIVE_KEY: "env-key" },
  });

  assert.equal(config.feed_steem_account, "tester");
  assert.equal(config.feed_steem_active_key, "env-key");
  assert.deepEqual(config.exchanges, ["poloniex", "binance"]);
});

test("loadConfig falls back to global values when the local file is missing", () => {
  const config = loadConfig({
    cwd: __dirname,
    localPaths: [path.join(FIXTURES, "does-not-exist.yaml")],
    globalPaths: [path.join(FIXTURES, "global.yaml")],
    env: {},
  });

  assert.equal(config.feed_steem_account, "global-user");
  assert.deepEqual(config.exchanges, ["binance"]);
});

test("loadConfig parses JSON local config files", () => {
  const config = loadConfig({
    cwd: __dirname,
    localPaths: [path.join(FIXTURES, "local.json")],
    globalPaths: [path.join(FIXTURES, "global.yaml")],
    env: {},
  });

  assert.equal(config.feed_steem_account, "json-account");
  assert.equal(config.interval, 42);
  assert.deepEqual(config.exchanges, ["coingecko", "cryptocompare"]);
});

test("loadConfig returns an empty object when no config files exist", () => {
  const config = loadConfig({
    cwd: __dirname,
    localPaths: [path.join(FIXTURES, "missing-local.yaml")],
    globalPaths: [path.join(FIXTURES, "missing-global.yaml")],
    env: {},
  });

  assert.deepEqual(config, {});
});
