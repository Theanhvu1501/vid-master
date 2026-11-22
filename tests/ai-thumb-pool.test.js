import test from "node:test";
import assert from "node:assert/strict";
import { createThumbAccountPool, drawWithAccounts, classifyDrawError, COOLDOWN } from "../sheet/ai-thumb-pool.js";

const A = (id, st = "logged_in") => ({ id, name: id, lastLoginStatus: st });

test("classifyDrawError: phân loại lỗi login/quota/verify/other", () => {
  assert.equal(classifyDrawError({ step: "need_login" }), "login");
  assert.equal(classifyDrawError({ errorCode: "quota" }), "quota");
  assert.equal(classifyDrawError({ message: "Google Labs phát hiện hoạt động bất thường và yêu cầu xác minh." }), "verify");
  assert.equal(classifyDrawError({ message: "lỗi lạ" }), "other");
});

test("pool.order: xoay vòng giữa các account đã đăng nhập; account chưa rõ để sau; đã đăng xuất bị bỏ", () => {
  const p = createThumbAccountPool({ listAccounts: () => [A("a"), A("b"), A("x", "unknown"), A("out", "logged_out")] });
  assert.deepEqual(p.order().map((a) => a.id), ["a", "b", "x"]);
  assert.deepEqual(p.order().map((a) => a.id), ["b", "a", "x"]);
  assert.deepEqual(p.order().map((a) => a.id), ["a", "b", "x"]);
  assert.deepEqual(createThumbAccountPool({ listAccounts: () => [] }).order(), []);
});

test("drawWithAccounts: account đầu hết hạn mức thì sang account kế; account lỗi được nghỉ, hết giờ nghỉ mới dùng lại", async () => {
  let t = 1000; const used = [];
  const p = createThumbAccountPool({ listAccounts: () => [A("a"), A("b")], now: () => t });
  const draw = async (acc) => { used.push(acc.id); return acc.id === "a" ? { ok: false, kind: "quota", message: "hết lượt" } : { ok: true }; };
  const r1 = await drawWithAccounts({ pool: p, draw });
  assert.equal(r1.ok, true); assert.equal(r1.accountId, "b"); assert.deepEqual(used, ["a", "b"]); assert.equal(r1.tried[0].kind, "quota");
  used.length = 0;
  const r2 = await drawWithAccounts({ pool: p, draw });
  assert.deepEqual(used, ["b"], "a đang nghỉ nên không bị thử lại ngay");
  t += COOLDOWN.quota + 1; used.length = 0;
  await drawWithAccounts({ pool: p, draw });
  assert.ok(used.includes("a"), "hết giờ nghỉ thì a được dùng lại");
});

test("drawWithAccounts: tất cả account lỗi thì trả ok:false kèm lý do từng account; ngoại lệ không làm sập", async () => {
  const p = createThumbAccountPool({ listAccounts: () => [A("a"), A("b")] });
  const r = await drawWithAccounts({ pool: p, draw: async (acc) => { if (acc.id === "a") throw new Error("Chrome sập"); return { ok: false, kind: "login", message: "chưa đăng nhập" }; } });
  assert.equal(r.ok, false); assert.deepEqual(r.tried.map((x) => x.kind), ["other", "login"]);
  assert.equal((await drawWithAccounts({ pool: createThumbAccountPool({ listAccounts: () => [] }), draw: async () => ({ ok: true }) })).ok, false);
});

test("withAccount: mỗi account chỉ vẽ MỘT ảnh một lúc (hai yêu cầu cùng account xếp hàng), account khác chạy song song", async () => {
  const p = createThumbAccountPool({ listAccounts: () => [A("a"), A("b")] });
  const log = []; const gate = {};
  const job = (id, tag) => p.withAccount(id, async () => { log.push("start " + tag); await new Promise((r) => (gate[tag] = r)); log.push("end " + tag); });
  const j1 = job("a", "a1"), j2 = job("a", "a2"), j3 = job("b", "b1");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log.filter((l) => l.startsWith("start")), ["start a1", "start b1"], "a2 phải chờ a1");
  gate.a1(); await new Promise((r) => setTimeout(r, 10));
  assert.ok(log.includes("start a2")); gate.a2(); gate.b1(); await Promise.all([j1, j2, j3]);
});
