const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig, replaceEnvPlaceholders } = require("../config-loader");

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

test("loadConfig merges local YAML values over global config and resolves env placeholders", () => {
  const config = loadConfig({
    cwd: __dirname,
    localPaths: [__dirname + "/fixtures/config.yaml"],
    globalPaths: [__dirname + "/fixtures/global.yaml"],
    env: { FEED_STEEM_ACCOUNT: "tester", FEED_STEEM_ACTIVE_KEY: "env-key" },
  });

  assert.equal(config.feed_steem_account, "tester");
  assert.equal(config.feed_steem_active_key, "env-key");
  assert.deepEqual(config.exchanges, ["poloniex", "binance"]);
});
