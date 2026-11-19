import test from "node:test";
import assert from "node:assert/strict";
import {
  readChannelRows, describeTask, assertTaskColumns, selectForTask, makeStatusWriter, statusText,
  runSheetTask, createMissingColumns, listChannelsForUi, parseAccount, TASKS,
} from "../sheet/channel-sheet.js";
import { splitPostTimes, parsePostTimes, toStudioTime, assignTomorrowSlots } from "../sheet/schedule-slots.js";

const HEAD = ["Tên kênh", "Proxy tải", "GPM Profile ID", "tk", "Giờ đăng"];
const VALUES = [
  ["nhóm"],                                   // dòng nhóm phía trên, header ở dòng 2
  HEAD,
  ["K1", "1.1.1.1:80:u:SECRETP", "P1", "a@gmail.com|PW1|r@x.com|ABCD", "8:00 AM; 6:30 PM"],
  ["K2", "", "", "b@gmail.com|PW2", "8:00, 18:00"],
  ["K3", "", "P3", "hỏng", "25:99"],
  ["", "", "", "", ""],
];
const GPM = [{ id: "P1", name: "K1", groupId: 1, rawProxy: "" }, { id: "P3", name: "K3", groupId: 1, rawProxy: "" }];

test("readChannelRows: đọc đúng cột, số dòng 1-based, bỏ dòng trống", () => {
  const { rows } = readChannelRows(VALUES);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sheetName, "K1");
  assert.equal(rows[0].rowIndex, 3);
  assert.equal(rows[0].gpmProfileId, "P1");
  assert.equal(rows[1].gpmProfileId, "");
});

test("readChannelRows: thiếu cột Tên kênh -> báo lỗi", () => {
  assert.throws(() => readChannelRows([["a", "b"], ["1", "2"]]), /Tên kênh/);
});

test("describeTask: nói rõ cột nào có/thiếu, bắt buộc hay tuỳ chọn", () => {
  const d = describeTask(VALUES, "login");
  assert.equal(d.ready, true);
  assert.deepEqual(d.reads.map((c) => [c.label, c.present]), [["Tên kênh", true], ["GPM Profile ID", true], ["tk", true]]);
  assert.deepEqual(d.writes.map((c) => [c.label, c.present]), [["Trạng thái login", false]]);
  assert.deepEqual(d.creatable, ["Trạng thái login"]);
});

test("describeTask: thiếu cột bắt buộc -> ready=false và liệt kê", () => {
  const d = describeTask([["Tên kênh"], ["K1"]], "schedule");
  assert.equal(d.ready, false);
  assert.deepEqual(d.missingRequired, ["GPM Profile ID", "Giờ đăng"]);
  assert.throws(() => assertTaskColumns([["Tên kênh"], ["K1"]], "schedule"), /Giờ đăng/);
});

test("mỗi chức năng khai báo cột đọc/ghi hợp lệ", () => {
  for (const [id, t] of Object.entries(TASKS)) {
    assert.ok(t.label, id);
    assert.ok(t.reads.some((c) => c.key === "sheetName"), `${id} phải đọc Tên kênh`);
  }
});

test("selectForTask login: chỉ giữ kênh có Profile ID tồn tại và tk hợp lệ, nêu lý do loại", () => {
  const { rows } = readChannelRows(VALUES);
  const { profiles, skipped } = selectForTask({ task: "login", rows, names: ["K1", "K2", "K3"], gpmProfiles: GPM });
  assert.deepEqual(profiles.map((p) => p.name), ["K1"]);
  assert.equal(profiles[0].account.password, "PW1");
  assert.equal(skipped.length, 2);
  assert.match(skipped.find((s) => s.name === "K2").reason, /chưa có GPM Profile ID/);
  assert.match(skipped.find((s) => s.name === "K3").reason, /cột tk/);
});

test("selectForTask: tên không còn trong Sheet được báo, không im lặng", () => {
  const { rows } = readChannelRows(VALUES);
  const { skipped } = selectForTask({ task: "login", rows, names: ["K1", "Đã xoá"], gpmProfiles: GPM });
  assert.ok(skipped.some((s) => s.name === "Đã xoá" && /không thấy trong Sheet/.test(s.reason)));
});

test("selectForTask: Profile ID có trong Sheet nhưng không có trong GPM -> loại", () => {
  const { rows } = readChannelRows(VALUES);
  const { profiles, skipped } = selectForTask({ task: "login", rows, names: ["K1"], gpmProfiles: [] });
  assert.equal(profiles.length, 0);
  assert.match(skipped[0].reason, /không có trong GPM/);
});

test("selectForTask schedule: giờ sai bị loại kèm giờ nào sai; giờ AM/PM được nhận", () => {
  const { rows } = readChannelRows(VALUES);
  const { profiles, skipped } = selectForTask({ task: "schedule", rows, names: ["K1", "K3"], gpmProfiles: GPM });
  assert.deepEqual(profiles.map((p) => p.name), ["K1"]);
  assert.match(skipped[0].reason, /"25:99"/);
});

test("selectForTask thumb: suy ra thư mục overlays của kênh; thiếu thư mục thì loại", () => {
  const { rows } = readChannelRows(VALUES);
  const ok = selectForTask({ task: "thumb", rows, names: ["K1"], gpmProfiles: GPM, channelsRoot: "D:\\VM", exists: () => true });
  assert.match(ok.profiles[0].thumbFolder, /K1[\\/]overlays$/);
  const no = selectForTask({ task: "thumb", rows, names: ["K1"], gpmProfiles: GPM, channelsRoot: "D:\\VM", exists: () => false });
  assert.match(no.skipped[0].reason, /không thấy thư mục/);
  const noRoot = selectForTask({ task: "thumb", rows, names: ["K1"], gpmProfiles: GPM, exists: () => true });
  assert.match(noRoot.skipped[0].reason, /Channels root/);
});

test("selectForTask: chưa chọn kênh nào thì báo lỗi", () => {
  assert.throws(() => selectForTask({ task: "login", rows: [], names: [], gpmProfiles: [] }), /Chưa chọn/);
});

test("parseAccount dùng chung: đủ 4 phần, hoặc chỉ gmail|mật khẩu", () => {
  assert.equal(parseAccount("a@g.com|p|r@x.com|K").twoFactorSecret, "K");
  assert.throws(() => parseAccount("a@g.com"), /mật khẩu/);
});

// ---- ghi trạng thái ----
test("statusText: có dấu thời gian, ngắn gọn, cắt dòng thứ hai của lỗi", () => {
  const now = new Date(2026, 0, 5, 9, 7);
  assert.equal(statusText({ status: "ok", message: "đăng nhập" }, now), "✅ 05/01/2026 09:07 · đăng nhập");
  assert.match(statusText({ status: "error", message: "lỗi A\nchi tiết dài" }, now), /^❌ .* · lỗi A$/);
  assert.match(statusText({ status: "skip", message: "thiếu tk" }, now), /^⏭/);
});

test("makeStatusWriter: ghi tuần tự đúng ô; cột chưa có thì bỏ qua không lỗi", async () => {
  const writes = [];
  let active = 0, maxActive = 0;
  const writeCell = async (r, c, v) => { active++; maxActive = Math.max(maxActive, active); await new Promise((x) => setTimeout(x, 5)); writes.push([r, c]); active--; };
  const w = makeStatusWriter({ writeCell, cols: { loginStatus: 7 }, key: "loginStatus" });
  await Promise.all([w({ rowIndex: 3 }, { status: "ok" }), w({ rowIndex: 4 }, { status: "ok" }), w({ rowIndex: 5 }, { status: "ok" })]);
  assert.deepEqual(writes, [[3, 7], [4, 7], [5, 7]]);
  assert.equal(maxActive, 1, "không ghi chồng nhau");
  const none = makeStatusWriter({ writeCell, cols: {}, key: "loginStatus" });
  await none({ rowIndex: 3 }, { status: "ok" }); // không ném
  assert.equal(writes.length, 3);
});

// ---- runSheetTask ----
function deps(over = {}) {
  const writes = [];
  return {
    d: { readValues: async () => VALUES, listProfiles: async () => GPM, writeCell: async (r, c, v) => writes.push([r, c, v]), channelsRoot: "", ...over },
    writes,
  };
}

test("runSheetTask: chạy kênh hợp lệ, ghi kết quả đúng hàng, báo kênh bị loại", async () => {
  const { d } = deps({ readValues: async () => [VALUES[0], [...HEAD, "Trạng thái login"], ...VALUES.slice(2)] });
  const writes = [];
  d.writeCell = async (r, c, v) => writes.push([r, c, v]);
  const logs = [];
  let got;
  const r = await runSheetTask({
    task: "login", o: { names: ["K1", "K2"] }, deps: d, onLog: (m) => logs.push(m),
    runFn: async (o) => { got = o; await o.onResult(o.profiles[0], { status: "ok", message: "xong" }); return { success: true, message: "1/1" }; },
  });
  assert.deepEqual(got.profiles.map((p) => p.name), ["K1"]);
  assert.equal(r.preSkipped, 1);
  assert.ok(writes.some(([row, col, v]) => row === 3 && col === 5 && v.startsWith("✅")), "ghi kết quả K1 vào ô trạng thái");
  assert.ok(writes.some(([row, , v]) => row === 4 && v.startsWith("⏭")), "ghi lý do bỏ qua K2");
  assert.ok(logs.some((m) => m.includes("[K2]")));
  assert.ok(!JSON.stringify(logs).includes("PW1"), "log không chứa mật khẩu");
});

test("runSheetTask: thiếu cột bắt buộc thì dừng, không chạy gì", async () => {
  const { d } = deps({ readValues: async () => [["Tên kênh", "GPM Profile ID"], ["K1", "P1"]] });
  let ran = false;
  await assert.rejects(runSheetTask({ task: "login", o: { names: ["K1"] }, deps: d, runFn: async () => { ran = true; } }), /thiếu cột bắt buộc/);
  assert.equal(ran, false);
});

test("runSheetTask: không kênh nào chạy được thì báo lỗi rõ", async () => {
  const { d } = deps();
  await assert.rejects(runSheetTask({ task: "login", o: { names: ["K2"] }, deps: d, runFn: async () => ({}) }), /Không có kênh nào chạy được/);
});

// ---- tạo cột còn thiếu ----
test("createMissingColumns: thêm vào CUỐI dòng tiêu đề, mở rộng lưới, không đụng cột cũ", async () => {
  const writes = []; let ensured = 0;
  const made = await createMissingColumns({
    readValues: async () => VALUES,
    ensureColumns: async (n) => { ensured = n; },
    writeCell: async (r, c, v) => writes.push([r, c, v]),
  }, "login");
  assert.deepEqual(made, ["Trạng thái login"]);
  assert.deepEqual(writes, [[2, 5, "Trạng thái login"]]); // dòng tiêu đề = dòng 2, ngay sau cột thứ 5
  assert.equal(ensured, 6);
});

test("createMissingColumns: đủ cột rồi thì không làm gì", async () => {
  const writes = [];
  const made = await createMissingColumns({
    readValues: async () => [["Tên kênh", "GPM Profile ID", "tk", "Trạng thái login"], ["K1", "P1", "a@g.com|p", ""]],
    writeCell: async (...x) => writes.push(x),
  }, "login");
  assert.deepEqual(made, []);
  assert.equal(writes.length, 0);
});

// ---- danh sách cho giao diện ----
test("listChannelsForUi: không lộ mật khẩu hay proxy gốc; có tên group và trạng thái", () => {
  const { rows } = readChannelRows(VALUES);
  const out = listChannelsForUi({ rows, profiles: GPM, groups: [{ id: 1, name: "G1" }] });
  const s = JSON.stringify(out);
  for (const secret of ["PW1", "PW2", "ABCD", "SECRETP"]) assert.ok(!s.includes(secret), `lộ ${secret}`);
  assert.equal(out[0].groupName, "G1");
  assert.equal(out[0].proxyMasked, "http://1.1.1.1:80");
  assert.equal(out[1].profileId, "");
});

// ---- Giờ đăng thống nhất ----
test("splitPostTimes: nhận 24h và AM/PM, cả dấu phẩy lẫn chấm phẩy, báo giờ sai", () => {
  assert.deepEqual(splitPostTimes("8:00 AM; 6:30 PM, 12:00 PM, 12:00 AM").times, ["08:00", "18:30", "12:00", "00:00"]);
  assert.deepEqual(splitPostTimes("8:00, 25:00, abc, 13:00 PM"), { times: ["08:00"], invalid: ["25:00", "abc", "13:00 PM"] });
  assert.deepEqual(splitPostTimes("").times, []);
});

test("parsePostTimes cũ vẫn chạy như trước với giờ 24h", () => {
  assert.deepEqual(parsePostTimes("8:00, 18:00"), ["08:00", "18:00"]);
  assert.deepEqual(parsePostTimes("  9:5 , 25:00, 12:30 "), ["12:30"]);
});

test("toStudioTime: đổi sang dạng ô giờ của Studio", () => {
  assert.equal(toStudioTime("08:00"), "8:00 AM");
  assert.equal(toStudioTime("18:30"), "6:30 PM");
  assert.equal(toStudioTime("00:15"), "12:15 AM");
  assert.equal(toStudioTime("12:00"), "12:00 PM");
});

test("assignTomorrowSlots (theo dõi Sheet) giờ đây nhận cả giờ AM/PM", () => {
  const out = assignTomorrowSlots("8:00 AM, 6:30 PM", [], new Date(2026, 5, 1, 10), 2);
  assert.deepEqual(out, ["2026-06-02T08:00:00", "2026-06-02T18:30:00"]);
});
