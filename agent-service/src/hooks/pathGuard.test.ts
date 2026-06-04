// pathGuard 单元测试（node --test）。验证受保护路径被 block、普通路径放行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathGuard } from "./pathGuard.js";

test("write .pi/skills/* is blocked", () => {
  const r = pathGuard({ name: "write", input: { path: ".pi/skills/x.md" } });
  assert.equal(r.block, true);
  assert.match(r.reason ?? "", /skill_propose/);
});

test("write .pi/prompts/* is blocked", () => {
  assert.equal(pathGuard({ name: "write", input: { path: ".pi/prompts/ord.md" } }).block, true);
});

test("write project/SYSTEM.md is blocked", () => {
  assert.equal(pathGuard({ name: "write", input: { path: "project/SYSTEM.md" } }).block, true);
});

test("write src/ is blocked", () => {
  assert.equal(pathGuard({ name: "write", input: { path: "src/agent.ts" } }).block, true);
});

test("write normal path is allowed", () => {
  assert.notEqual(pathGuard({ name: "write", input: { path: "notes/draft.md" } }).block, true);
});

test("bash git push is blocked", () => {
  assert.equal(pathGuard({ name: "bash", input: { cmd: "git push origin main" } }).block, true);
});

test("bash npm i is blocked", () => {
  assert.equal(pathGuard({ name: "bash", input: { cmd: "npm i lodash" } }).block, true);
});

test("bash normal cmd is allowed", () => {
  assert.notEqual(pathGuard({ name: "bash", input: { cmd: "ls -la" } }).block, true);
});

test("edit .pi/skills is blocked", () => {
  assert.equal(pathGuard({ name: "edit", input: { path: ".pi/skills/y.md" } }).block, true);
});
