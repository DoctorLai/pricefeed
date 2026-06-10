const steem = require("steem");
const request = require("request");

const { log } = require("../functions");
const { loadConfig } = require("./config-loader");

const config = loadConfig();

function getSetting(name, fallback) {
  if (typeof config[name] !== "undefined" && config[name] !== "") {
    return config[name];
  }

  if (typeof process.env[name] !== "undefined" && process.env[name] !== "") {
    return process.env[name];
  }

  return fallback;
}

function getActiveKey() {
  return getSetting("feed_steem_active_key");
}

function getAccountName() {
  return getSetting("feed_steem_account");
}

function fetchJson(url, onSuccess, onError) {
  request.get({ url, timeout: 20000 }, (error, response, body) => {
    if (error) {
      onError(error);
      return;
    }

    if (!response || response.statusCode >= 400) {
      onError(
        new Error("HTTP " + (response ? response.statusCode : "unknown")),
      );
      return;
    }

    try {
      onSuccess(JSON.parse(body));
    } catch (err) {
      onError(err);
    }
  });
}

log(__filename);
log(config.rpc_nodes || []);

if (!Array.isArray(config.rpc_nodes) || config.rpc_nodes.length < 3) {
  log("Please provide at least three rpc_nodes in config.yaml/config.json");
  process.exit(1);
}

const rpcNode = config.rpc_nodes[0] || "https://api.steemit.com";
steem.api.setOptions({ transport: "https", uri: rpcNode, url: rpcNode });

function failover() {
  if (!Array.isArray(config.rpc_nodes) || config.rpc_nodes.length <= 1) {
    return;
  }

  let curNodeIndex = config.rpc_nodes.indexOf(steem.api.options.url) + 1;

  if (curNodeIndex >= config.rpc_nodes.length) {
    curNodeIndex = 0;
  }

  const nextNode = config.rpc_nodes[curNodeIndex];

  steem.api.setOptions({ transport: "https", uri: nextNode, url: nextNode });
  log("***********************************************");
  log("Failing over to: " + nextNode);
  log("***********************************************");
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
  log("no exchanges are specified.");
  process.exit(1);
}

function startProcess() {
  let prices = [];

  if (config.exchanges.indexOf("binance") >= 0) {
    loadPriceBinance(function (price) {
      prices.push(price);
    }, 0);
  }

  if (config.exchanges.indexOf("poloniex") >= 0) {
    loadPricePoloniex(function (price) {
      prices.push(price);
    }, 0);
  }

  if (config.exchanges.indexOf("cloudflare") >= 0) {
    loadPriceCloudflare(function (price) {
      prices.push(price);
    }, 0);
  }

  if (config.exchanges.indexOf("slowapi") >= 0) {
    loadPriceSlowApi(function (price) {
      prices.push(price);
    }, 0);
  }

  if (config.exchanges.indexOf("coingecko") >= 0) {
    loadPriceCoingecko(function (price) {
      prices.push(price);
    }, 0);
  }

  if (config.exchanges.indexOf("cryptocompare") >= 0) {
    loadPriceCryptocompare(function (price) {
      prices.push(price);
    }, 0);
  }

  // Publish the average of all markets that were loaded
  setTimeout(
    function () {
      if (prices.length === 0) {
        log("no prices found.");
        return;
      }
      const validPrices = prices.filter((value) => !isNaN(value));
      if (validPrices.length === 0) {
        log("No valid prices found.");
        return;
      }

      const price =
        validPrices.reduce((total, value) => total + value, 0) /
        validPrices.length;
      log("Price candidates: " + JSON.stringify(prices));
      log("Price = " + price);
      publishFeed(price, 0);
    },
    (config.feed_publish_interval || 30) * 1000,
  );
}

function publishFeed(price, retries) {
  const peg_multi = config.peg_multi ? config.peg_multi : 1;
  const exchange_rate = {
    base: price.toFixed(3) + " SBD",
    quote: (1 / peg_multi).toFixed(3) + " STEEM",
  };

  log(
    "Broadcasting feed_publish transaction: " + JSON.stringify(exchange_rate),
  );

  steem.broadcast.feedPublish(
    getActiveKey(),
    getAccountName(),
    exchange_rate,
    function (err, result) {
      if (result && !err) {
        log("Broadcast successful!");
      } else {
        log("Error broadcasting feed_publish transaction: " + err);

        if (retries > 0 && retries % config.feed_publish_fail_retry === 0) {
          failover();
        }

        setTimeout(
          function () {
            publishFeed(price, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

function loadPriceCryptocompare(callback, retries) {
  fetchJson(
    "https://min-api.cryptocompare.com/data/price?fsym=STEEM&tsyms=USDT",
    function (data) {
      const steem_price = parseFloat(data.USDT);
      log("Loaded STEEM Price from Cryptocompare: " + steem_price);

      if (callback) {
        callback(steem_price);
      }
    },
    function (err) {
      log("Error loading STEEM price from Cryptocompare: " + err);

      if (retries <= (config.price_feed_max_retry || 5)) {
        setTimeout(
          function () {
            loadPriceCryptocompare(callback, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

function loadPriceCoingecko(callback, retries) {
  fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd",
    function (data) {
      const steem_price = parseFloat(data.steem.usd);
      log("Loaded STEEM Price from Coingecko: " + steem_price);

      if (callback) {
        callback(steem_price);
      }
    },
    function (err) {
      log("Error loading STEEM price from Coingecko: " + err);

      if (retries <= (config.price_feed_max_retry || 5)) {
        setTimeout(
          function () {
            loadPriceCoingecko(callback, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

function loadPriceBinance(callback, retries) {
  fetchJson(
    "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    function (btcData) {
      fetchJson(
        "https://api.binance.com/api/v3/ticker/price?symbol=STEEMBTC",
        function (steemData) {
          const steem_price =
            parseFloat(btcData.price) * parseFloat(steemData.price);
          log("Loaded STEEM Price from Binance: " + steem_price);

          if (callback) {
            callback(steem_price);
          }
        },
        function (err) {
          log("Error loading STEEM price from Binance: " + err);

          if (retries <= (config.price_feed_max_retry || 5)) {
            setTimeout(
              function () {
                loadPriceBinance(callback, retries + 1);
              },
              (config.retry_interval || 10) * 1000,
            );
          }
        },
      );
    },
    function (err) {
      log("Error loading STEEM price from Binance: " + err);

      if (retries <= (config.price_feed_max_retry || 5)) {
        setTimeout(
          function () {
            loadPriceBinance(callback, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

function loadPricePoloniex(callback, retries) {
  request.get("https://api.poloniex.com/markets/price", function (e, r, data) {
    if (e) {
      log(e);
      log(r.statusCode);
      return;
    }
    try {
      let jdata = JSON.parse(data);
      let json_data = {};
      jdata.forEach((x) => {
        json_data[x["symbol"]] = x;
      });
      let steem_price = -1;
      if (json_data["STEEM_USDT"]) {
        steem_price = parseFloat(json_data["STEEM_USDT"].price);
        log("Poloniex path: STEEM_USDT");
      }
      if (json_data["STEEM_BTC"] && json_data["BTC_USDT"]) {
        steem_price =
          parseFloat(json_data["STEEM_BTC"].price) *
          parseFloat(json_data["BTC_USDT"].price);
        log("Poloniex path: STEEM_BTC * BTC_USDT");
      }
      if (json_data["STEEM_TRX"] && json_data["TRX_USDT"]) {
        steem_price =
          parseFloat(json_data["STEEM_TRX"].price) *
          parseFloat(json_data["TRX_USDT"].price);
        log("Poloniex path: STEEM_TRX * TRX_USDT");
      }
      if (steem_price > 0) {
        log("Loaded STEEM Price from Poloniex: " + steem_price);
        if (callback) {
          callback(steem_price);
        }
      } else {
        throw "Poloniex API Error!";
      }
    } catch (err) {
      log("Error loading STEEM price from Poloniex: " + err);

      if (retries <= config.price_feed_max_retry) {
        setTimeout(function () {
          loadPricePoloniex(callback, retries + 1);
        }, config.retry_interval * 1000);
      }
    }
  });
}

function loadPriceCloudflare(callback, retries) {
  fetchJson(
    "https://ticker.justyy.com/query/?s=STEEM+USDT",
    function (json_data) {
      const arr = json_data.result[0].split(" ");
      const steem_price = parseFloat(arr[3]);
      log("Loaded STEEM Price from Cloudflare: " + steem_price);

      if (callback) {
        callback(steem_price);
      }
    },
    function (err) {
      log("Error loading STEEM price from Cloudflare: " + err);

      if (retries <= (config.price_feed_max_retry || 5)) {
        setTimeout(
          function () {
            loadPriceCloudflare(callback, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

function loadPriceSlowApi(callback, retries) {
  fetchJson(
    "https://uploadbeta.com/api/yf/",
    function (json_data) {
      const steem_price = json_data.data["STEEM-USD"].regularMarketPrice;
      log("Loaded STEEM Price from SlowAPI: " + steem_price);

      if (callback) {
        callback(steem_price);
      }
    },
    function (err) {
      log("Error loading STEEM price from SlowAPI: " + err);

      if (retries <= (config.price_feed_max_retry || 5)) {
        setTimeout(
          function () {
            loadPriceSlowApi(callback, retries + 1);
          },
          (config.retry_interval || 10) * 1000,
        );
      }
    },
  );
}

setInterval(startProcess, (config.interval || 15) * 60 * 1000);
startProcess();
