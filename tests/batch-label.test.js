import test from "node:test";
import assert from "node:assert/strict";
import { batchesOfProfiles, batchTaskLabel } from "../sheet/task-monitor.js";

const BATCHES = [
  { id: 1, name: "Mẻ A", channels: [{ gpmProfileId: "p1" }, { gpmProfileId: "p2" }] },
  { id: 2, name: "Mẻ B", channels: [{ gpmProfileId: "p3" }] },
];

test("batchesOfProfiles: tìm mẻ chứa các profile của tác vụ, không lặp, giữ thứ tự", () => {
  assert.deepEqual(batchesOfProfiles(BATCHES, [{ id: "p2" }, { id: "p1" }]).map((b) => b.name), ["Mẻ A"]);
  assert.deepEqual(batchesOfProfiles(BATCHES, [{ id: "p3" }, { id: "p1" }]).map((b) => b.name), ["Mẻ B", "Mẻ A"]);
});

test("batchesOfProfiles: profile không thuộc mẻ nào thì bỏ; đầu vào rác trả mảng rỗng", () => {
  assert.deepEqual(batchesOfProfiles(BATCHES, [{ id: "zzz" }]), []);
  for (const bad of [null, undefined, "x", 5]) assert.deepEqual(batchesOfProfiles(bad, [{ id: "p1" }]), []);
  assert.deepEqual(batchesOfProfiles(BATCHES, null), []);
  assert.deepEqual(batchesOfProfiles([{ name: "X" }, null, { name: "Y", channels: null }], [{ id: "p1" }]), []);
  assert.deepEqual(batchesOfProfiles(BATCHES, [{ id: "p1" }, null, {}, { id: 5 }]).map((b) => b.name), ["Mẻ A"]);
});

test("batchTaskLabel: không thuộc mẻ thì giữ nguyên nhãn; một mẻ thì thêm tên mẻ; nhiều mẻ thì gộp", () => {
  assert.equal(batchTaskLabel("Lên lịch đăng", []), "Lên lịch đăng");
  assert.equal(batchTaskLabel("Lên lịch đăng", [{ name: "Mẻ A" }]), "Lên lịch đăng · Mẻ A");
  assert.equal(batchTaskLabel("Đổi thumbnail", [{ name: "Mẻ A" }, { name: "Mẻ B" }]), "Đổi thumbnail · Mẻ A, Mẻ B");
  assert.equal(batchTaskLabel("X", [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]), "X · A, B, C +1 mẻ");
});

test("batchTaskLabel: tên mẻ được làm sạch và cắt ngắn để không phá nhãn", () => {
  const long = "M".repeat(200);
  assert.ok(batchTaskLabel("Lên lịch đăng", [{ name: long }]).length <= 60, "nhãn không vượt 60 ký tự (giới hạn của server)");
  assert.equal(batchTaskLabel("L", [{ name: "  ab\n\tc  " }]), "L · ab c");
});
