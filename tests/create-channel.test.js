import test from "node:test";
import assert from "node:assert/strict";
import { createChannelOne } from "../sheet/create-channel.js";

// Page giả: ghi lại mọi thao tác theo thứ tự, không có trình duyệt thật.
function fakePage() {
  const ops = [];
  const loc = (sel) => ({
    first() { return loc(sel); },
    last() { return loc(sel + "|last"); },
    async fill(v) { ops.push(["fill", sel, v]); },
    async click() { ops.push(["click", sel]); },
  });
  return {
    ops,
    async goto(u) { ops.push(["goto", u]); },
    async click(sel) { ops.push(["click", sel]); },
    locator: loc,
  };
}
const fills = (ops) => ops.filter((o) => o[0] === "fill").map((o) => o[2]);
const clicks = (ops) => ops.filter((o) => o[0] === "click").map((o) => o[1]);

const NOWAIT = async () => {}; // bỏ chờ ngẫu nhiên để test chạy nhanh
const PLAN = { title: "Kênh Một", description: "mô tả kênh", videoDescription: "mô tả video", tags: "a,b", handle: "@kenh1" };

test("createChannelOne: điền đủ tên, handle, mô tả, tag và bấm Xuất bản sau cùng", async () => {
  const page = fakePage();
  await createChannelOne(page, PLAN, () => {}, NOWAIT);
  const f = fills(page.ops);
  for (const v of ["Kênh Một", "@kenh1", "mô tả kênh", "mô tả video", "a,b"]) assert.ok(f.includes(v), `thiếu ${v}`);
  assert.equal(f.filter((v) => v === "a,b").length, 2, "tag điền 2 lần như script gốc");
  const c = clicks(page.ops);
  assert.equal(c[c.length - 1], "#publish-button");
  assert.ok(c.indexOf("#submit-button") < c.indexOf("#menu-paper-icon-item-7"), "lưu cài đặt trước khi tuỳ chỉnh kênh");
});

test("createChannelOne: bỏ qua các ô trống thay vì điền chuỗi rỗng", async () => {
  const page = fakePage();
  await createChannelOne(page, { title: "Chỉ tên" }, () => {}, NOWAIT);
  assert.deepEqual(fills(page.ops), ["Chỉ tên"]);
});

test("createChannelOne: thiếu tên kênh thì từ chối, không động vào trình duyệt", async () => {
  const page = fakePage();
  await assert.rejects(createChannelOne(page, { title: "" }, () => {}, NOWAIT), /thiếu tên kênh/);
  assert.equal(page.ops.length, 0);
});
