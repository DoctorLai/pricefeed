"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_LOCAL_CONFIGS = ["config.yaml", "config.yml", "config.json"];
const DEFAULT_GLOBAL_DIR = "/var/www/steem/bots";

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function parseJson(content) {
  return JSON.parse(content);
}

function parseYaml(content) {
  try {
    // Prefer the bundled `yaml` package so config parsing does not depend on a
    // system Python interpreter (which is absent in the Alpine Docker image).
    const yaml = require("yaml");
    return yaml.parse(content) || {};
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

/**
 * Expand `${VAR}` and `${VAR:-default}` placeholders within a string using the
 * provided environment.
 *
 * - `${VAR}` resolves to the env value, or the literal placeholder if unset
 *   (so misconfiguration surfaces loudly).
 * - `${VAR:-default}` resolves to the env value, or `default` (which may be an
 *   empty string) when the variable is unset or empty.
 *
 * @param {*} value - The value to expand (non-strings are returned untouched).
 * @param {object} [env=process.env] - The environment to read from.
 * @returns {*} The expanded value.
 */
function replaceEnvPlaceholders(value, env = process.env) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\$\{([^}]+?)\}/g, (match, expr) => {
    const sepIndex = expr.indexOf(":-");
    const hasFallback = sepIndex !== -1;
    const key = (hasFallback ? expr.slice(0, sepIndex) : expr).trim();
    const fallback = hasFallback ? expr.slice(sepIndex + 2).trim() : undefined;

    if (typeof env[key] !== "undefined" && env[key] !== "") {
      return env[key];
    }

    return hasFallback ? fallback : match;
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

/**
 * Load and merge configuration from local and global config files, then expand
 * environment placeholders. Local values take precedence over global ones.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Base directory for local configs.
 * @param {string[]} [options.localPaths] - Override local config candidates.
 * @param {string[]} [options.globalPaths] - Override global config candidates.
 * @param {object} [options.env=process.env] - Environment for placeholder expansion.
 * @returns {object} The merged, expanded configuration object.
 */
function loadConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const localCandidates =
    options.localPaths ||
    DEFAULT_LOCAL_CONFIGS.map((name) => path.join(cwd, name));
  const globalCandidates =
    options.globalPaths ||
    DEFAULT_LOCAL_CONFIGS.map((name) => path.join(DEFAULT_GLOBAL_DIR, name));

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
  DEFAULT_GLOBAL_DIR,
  loadConfig,
  replaceEnvPlaceholders,
  replacePlaceholdersInObject,
};
