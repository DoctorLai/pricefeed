const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_LOCAL_CONFIGS = ["config.yaml", "config.yml", "config.json"];

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function parseJson(content) {
  return JSON.parse(content);
}

function parseYaml(content) {
  try {
    const yaml = require("yaml");
    return yaml.parse(content);
  } catch (err) {
    const output = execFileSync(
      "python3",
      [
        "-c",
        "import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read()) or {}, separators=(',', ':')))",
      ],
      { input: content, encoding: "utf8" },
    );

    return JSON.parse(output);
  }
}

function parseConfigFile(filePath) {
  const content = readFileIfExists(filePath);

  if (!content) {
    return {};
  }

  if (/\.ya?ml$/i.test(filePath)) {
    return parseYaml(content);
  }

  return parseJson(content);
}

function replaceEnvPlaceholders(value, env = process.env) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\$\{([^}]+?)\}/g, (match, expr) => {
    const parts = expr.split(":-");
    const key = parts[0].trim();
    const fallback = parts[1] !== undefined ? parts[1].trim() : "";

    if (typeof env[key] !== "undefined" && env[key] !== "") {
      return env[key];
    }

    return fallback || match;
  });
}

function replacePlaceholdersInObject(value, env = process.env) {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholdersInObject(item, env));
  }

  if (value && typeof value === "object") {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = replacePlaceholdersInObject(value[key], env);
      return acc;
    }, {});
  }

  return replaceEnvPlaceholders(value, env);
}

function loadConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const localCandidates =
    options.localPaths ||
    DEFAULT_LOCAL_CONFIGS.map((name) => path.join(cwd, name));
  const globalCandidates = options.globalPaths || [
    path.join("/var/www/steem/bots", "config.yaml"),
    path.join("/var/www/steem/bots", "config.yml"),
    path.join("/var/www/steem/bots", "config.json"),
  ];

  const localConfig =
    localCandidates
      .map((candidate) => parseConfigFile(candidate))
      .find((value) => Object.keys(value).length > 0) || {};

  const globalConfig =
    globalCandidates
      .map((candidate) => parseConfigFile(candidate))
      .find((value) => Object.keys(value).length > 0) || {};

  const merged = Object.assign({}, globalConfig, localConfig);
  return replacePlaceholdersInObject(merged, options.env || process.env);
}

module.exports = {
  DEFAULT_LOCAL_CONFIGS,
  loadConfig,
  replaceEnvPlaceholders,
  replacePlaceholdersInObject,
};
