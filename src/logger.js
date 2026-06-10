"use strict";

/**
 * Render any value into a single log-friendly string.
 *
 * @param {*} message - The value to format.
 * @returns {string} A printable representation of the value.
 */
function formatMessage(message) {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof Error) {
    return message.stack || message.message;
  }

  try {
    return JSON.stringify(message);
  } catch (err) {
    return String(message);
  }
}

/**
 * Write a timestamped message to stdout.
 *
 * @param {*} message - The value to log.
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${formatMessage(message)}`);
}

module.exports = { log, formatMessage };
