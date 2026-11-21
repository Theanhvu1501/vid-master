import test from "node:test";
import assert from "node:assert/strict";
import BL from "../sheet/batch-local.cjs";
const { LOCAL_FIELDS, cleanLocal, splitSettings, joinSettings, pruneLocal } = BL;

test("chỉ có các khóa đường dẫn thư mục là cục bộ", () => {
  assert.deepEqual(LOCAL_FIELDS, { render: ["overlayFolder", "backgroundFolder", "outputFolder"], thumb: ["thumbFolder"], schedule: [] });
});

test("splitSettings: tách đường dẫn (ở lại máy) khỏi phần gửi server; server không nhận đường dẫn", () => {
  const { local, remote } = splitSettings({ render: { overlayFolder: "D:/a", backgroundFolder: "D:/b", outputFolder: "E:/c" }, thumb: { thumbFolder: "D:/t", numVideos: "6" }, schedule: { numDays: "3", startDate: "2026-07-09", postTimes: "8:00" } });
  assert.deepEqual(local, { render: { overlayFolder: "D:/a", backgroundFolder: "D:/b", outputFolder: "E:/c" }, thumb: { thumbFolder: "D:/t" } });
  assert.deepEqual(remote, { thumb: { numVideos: "6" }, schedule: { numDays: "3", startDate: "2026-07-09", postTimes: "8:00" } });
  const j = JSON.stringify(remote); for (const bad of ["D:/", "E:/", "Folder"]) assert.ok(!j.includes(bad), bad);
});

test("joinSettings: ghép lại đủ; phần đường dẫn lấy từ máy, phần còn lại từ server; máy thắng khi trùng khóa đường dẫn", () => {
  const j = joinSettings({ thumb: { numVideos: "6" }, schedule: { numDays: "3" } }, { render: { outputFolder: "E:/c" }, thumb: { thumbFolder: "D:/t" } });
  assert.deepEqual(j, { render: { outputFolder: "E:/c" }, thumb: { numVideos: "6", thumbFolder: "D:/t" }, schedule: { numDays: "3" } });
  assert.deepEqual(joinSettings({ render: { overlayFolder: "TU_SERVER" } }, { render: { overlayFolder: "D:/may" } }).render, { overlayFolder: "D:/may" }, "server cũ có đường dẫn thì bị bỏ, lấy từ máy");
  assert.deepEqual(joinSettings({ render: { overlayFolder: "TU_SERVER" } }, {}).render || {}, {}, "đường dẫn từ server không được nhận vào");
});

test("cleanLocal: chỉ giữ khóa và kiểu chuỗi hợp lệ, cắt độ dài, bỏ rác", () => {
  assert.deepEqual(cleanLocal({ render: { overlayFolder: " D:/a ", hack: "x", outputFolder: 5 }, thumb: { thumbFolder: "D:/t", numVideos: "6" }, bay: {} }), { render: { overlayFolder: "D:/a" }, thumb: { thumbFolder: "D:/t" } });
  assert.equal(cleanLocal({ render: { outputFolder: "E:/" + "a".repeat(2000) } }).render.outputFolder.length, 1000);
  for (const bad of [null, undefined, "x", 5, []]) assert.deepEqual(cleanLocal(bad), {});
});

test("pruneLocal: xóa dữ liệu của mẻ đã bị xóa, giữ mẻ còn tồn tại", () => {
  const all = { "1": { render: { outputFolder: "E:/1" } }, "2": { render: { outputFolder: "E:/2" } }, "3": {} };
  const out = pruneLocal(all, [1, 3]);
  assert.deepEqual(Object.keys(out).sort(), ["1", "3"]); assert.equal(out["1"].render.outputFolder, "E:/1");
  assert.deepEqual(pruneLocal(null, [1]), {}); assert.deepEqual(pruneLocal(all, null), all, "không biết danh sách mẻ thì không xóa gì (tránh mất dữ liệu khi lỗi mạng)");
});

const { planUpdate } = BL;

test("planUpdate: chỉ có phần server (không có đường dẫn) thì KHÔNG đụng tới đường dẫn đã lưu tại máy", () => {
  const p = planUpdate({ actions: { schedule: { numDays: "4" } } });
  assert.equal(p.saveLocal, null, "không được ghi đè (kể cả ghi object rỗng) đường dẫn đã có");
  assert.deepEqual(p.remoteBody, { actions: { schedule: { numDays: "4" } } }); assert.equal(p.callServer, true);
});

test("planUpdate: chỉ có đường dẫn thì chỉ lưu tại máy, không gọi server", () => {
  const p = planUpdate({ actions: { render: { outputFolder: "E:/x" } } });
  assert.deepEqual(p.saveLocal, { render: { outputFolder: "E:/x" } }); assert.equal(p.callServer, false); assert.deepEqual(p.remoteBody, {});
});

test("planUpdate: lẫn cả hai thì tách đúng; trường khác (name, render...) vẫn lên server; đường dẫn không lọt vào server", () => {
  const p = planUpdate({ name: "A", currentDay: 3, actions: { render: { outputFolder: "E:/x" }, thumb: { thumbFolder: "D:/t", numVideos: "5" } } });
  assert.deepEqual(p.saveLocal, { render: { outputFolder: "E:/x" }, thumb: { thumbFolder: "D:/t" } });
  assert.deepEqual(p.remoteBody, { name: "A", currentDay: 3, actions: { thumb: { numVideos: "5" } } }); assert.equal(p.callServer, true);
  assert.ok(!JSON.stringify(p.remoteBody).includes("E:/x") && !JSON.stringify(p.remoteBody).includes("D:/t"));
});

test("planUpdate: không có actions thì mọi thứ lên server như cũ và không động tới đường dẫn", () => {
  const p = planUpdate({ name: "B" });
  assert.equal(p.saveLocal, null); assert.deepEqual(p.remoteBody, { name: "B" }); assert.equal(p.callServer, true);
  for (const bad of [null, undefined, "x", 5]) { const q = planUpdate(bad); assert.equal(q.saveLocal, null); assert.equal(q.callServer, false); }
});

test("planUpdate: khóa đường dẫn rỗng (người dùng bấm ×) vẫn được lưu tại máy để xóa đường dẫn cũ", () => {
  assert.deepEqual(planUpdate({ actions: { render: { outputFolder: "" } } }).saveLocal, { render: { outputFolder: "" } });
});
