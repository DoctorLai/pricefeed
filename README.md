# Steem Witness Price Feed Publishing Tool

[![CI](https://github.com/DoctorLai/pricefeed/actions/workflows/ci.yml/badge.svg)](https://github.com/DoctorLai/pricefeed/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![image](https://user-images.githubusercontent.com/1764434/173547905-6366f5eb-22dc-4327-bbda-6a4cc4cd3b96.png)

Publishes a STEEM price feed for your witness account. Prices are pulled from
multiple exchanges, validated, averaged, and broadcast to the Steem blockchain
on a configurable interval, with automatic RPC-node failover.

## Requirements

- Node.js 18 or newer (the price feed uses the built-in `fetch` API).

## Install Node.js & npm

If you already have Node.js & npm installed you can skip this section.
Otherwise, install a current LTS release:

```
$ sudo apt-get update
$ curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
$ sudo apt-get install -y nodejs
```

## Setup & Installation

Clone the project repo and install dependencies with npm:

```
$ git clone https://github.com/DoctorLai/pricefeed.git pricefeed
$ cd pricefeed
$ npm install
$ cp config.sample.yaml config.yaml
$ npm test
```

Edit `config.yaml` with your witness account name and private active key as
described in the [Configuration](#configuration) section below. The loader also
supports environment substitution such as `${FEED_STEEM_ACCOUNT:-justyy}` and
`${FEED_STEEM_ACTIVE_KEY:-}`, so you can keep secrets out of the repo.

Start the feed:

```
$ npm start
```

## Project structure

```
feed.js                 Entry point: validation, RPC failover, publish loop
src/
  config-loader.js      Loads & merges YAML/JSON config, expands ${ENV} vars
  logger.js             Timestamped logging
  http.js               fetch wrapper with timeout and JSON parsing
  price-sources.js      One validated price fetcher per exchange
  price-feed.js         Concurrent collection, retries, averaging, exchange rate
test/                   node:test unit tests and fixtures
```

## Available scripts

| Script               | Description                                         |
| -------------------- | --------------------------------------------------- |
| `npm start`          | Run the price feed.                                 |
| `npm test`           | Run the unit test suite (`node --test`).            |
| `npm run lint`       | Syntax-check every source and test file.            |
| `npm run format`     | Check formatting with Prettier.                     |
| `npm run format:fix` | Apply Prettier formatting.                          |
| `npm run ci`         | Run lint, tests, and the format check (used by CI). |

## Running in production

### Run in the background with PM2

PM2 keeps the process running in the background and restarts it on failure:

```
$ sudo npm install pm2 -g
$ pm2 start feed.js --name feed
$ pm2 logs feed
$ pm2 save
```

If everything worked you should see no errors in the logs and a price feed
transaction should have been published to your account.

### Run with Docker

```
# Build the image
$ docker build -t pricefeed .

# Edit config.yaml first, then run the container
$ docker run -itd \
    --name pricefeed \
    -v $(pwd)/config.yaml:/app/config.yaml:ro \
    pricefeed

# Check the status
$ docker logs pricefeed
```

You can also pass secrets via environment variables instead of putting them in
`config.yaml`:

```
$ docker run -itd \
    --name pricefeed \
    -e FEED_STEEM_ACCOUNT=yourwitness \
    -e FEED_STEEM_ACTIVE_KEY=yourkey \
    -v $(pwd)/config.yaml:/app/config.yaml:ro \
    pricefeed
```

### Run with Docker Compose

```
$ cp config.sample.yaml config.yaml      # edit rpc_nodes / exchanges as needed
$ cp .env.example .env                    # add your witness account + active key
$ docker compose up -d
$ docker compose logs -f
```

Docker Compose reads `FEED_STEEM_ACCOUNT` and `FEED_STEEM_ACTIVE_KEY` from your
`.env` file and passes them to the container, while `config.yaml` is mounted
read-only.

## Configuration

Configuration is read from the first file that exists, in this order:
`config.yaml`, `config.yml`, then `config.json`. Copy one of the bundled
samples (`config.sample.yaml` or `config.sample.json`) to a matching name to
get started. A global config under `/var/www/steem/bots/` is used as a fallback
for any values that are missing locally.

Example `config.yaml`:

```yaml
rpc_nodes:
  - https://api.steemit.com
  - https://api.justyy.com
  - https://api.moecki.online
feed_steem_account: ${FEED_STEEM_ACCOUNT:-justyy}
feed_steem_active_key: ${FEED_STEEM_ACTIVE_KEY:-}
exchanges:
  - poloniex
  - binance
  - slowapi
interval: 15
request_timeout: 20000
feed_publish_fail_retry: 5
price_feed_max_retry: 5
retry_interval: 10
peg_multi: 1
```

### Options

| Key                       | Description                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `rpc_nodes`               | List of STEEM RPC nodes (at least three required). The feed fails over to the next node on repeated errors. |
| `feed_steem_account`      | Your Steem witness account name. Falls back to the `FEED_STEEM_ACCOUNT` environment variable.               |
| `feed_steem_active_key`   | Your private active key. Falls back to the `FEED_STEEM_ACTIVE_KEY` environment variable.                    |
| `exchanges`               | Price sources to use. The published price is the average of all sources that respond successfully.          |
| `interval`                | Minutes between feed publishes.                                                                             |
| `request_timeout`         | Per-request timeout for exchange APIs, in milliseconds.                                                     |
| `feed_publish_fail_retry` | Fail over to the next RPC node after this many broadcast retries.                                           |
| `price_feed_max_retry`    | Maximum retries per exchange when fetching a price.                                                         |
| `retry_interval`          | Seconds to wait between retries.                                                                            |
| `peg_multi`               | Feed bias; the quote is set to `1 / peg_multi`.                                                             |

### Supported exchanges

`binance`, `poloniex`, `cloudflare`, `slowapi`, `coingecko`, `cryptocompare`.

Each source is fetched concurrently with a timeout. Invalid or non-numeric
responses are rejected and logged, and unknown exchange names are skipped with a
warning, so a single failing source never blocks publishing.

#### CryptoCompare API key (optional)

The `cryptocompare` source works without a key but is rate-limited. To use your
own key, set the `CRYPTOCOMPARE_API_KEY` environment variable — it is sent as an
`Authorization: Apikey <key>` header. With Docker Compose, add it to your `.env`
file and it is passed through to the container automatically.

## License

[MIT](LICENSE)
