"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { formatMessage } = require("../src/logger");

test("formatMessage returns strings unchanged", () => {
  assert.equal(formatMessage("hello"), "hello");
});

test("formatMessage serializes plain objects and arrays as JSON", () => {
  assert.equal(formatMessage({ a: 1 }), '{"a":1}');
  assert.equal(formatMessage([1, 2, 3]), "[1,2,3]");
});

test("formatMessage renders errors using their stack or message", () => {
  const err = new Error("boom");
  assert.ok(formatMessage(err).includes("boom"));
});

test("formatMessage falls back to String() for circular structures", () => {
  const circular = {};
  circular.self = circular;
  assert.equal(formatMessage(circular), "[object Object]");
});
