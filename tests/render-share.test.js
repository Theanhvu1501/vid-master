import test from "node:test";
import assert from "node:assert/strict";
import { SHARED_RENDER_KEYS, splitRenderSettings, mergeRenderSettings, isSecretLooking } from "../sheet/render-share.js";

// Cấu hình render thật của app (rút gọn): lẫn thông số dùng chung và đường dẫn/khóa riêng của máy.
const FULL = {
  day: "3", videos: "5", videoSpeed: "0.95", renderMode: "chromaKey", opacity: "0.7", chromaKeyMode: "color", chromaKeyColor: "D4F9D7",
  chromaKeySimilarity: "0.3", keepColorColors: "FBFF02", keepColorCrop: true, height: "220", y_offset: "490", bgBlurEnabled: true, bgBlur: "20",
  mainScale: "0.85", frameEnabled: true, framePath: "C:\\Users\\adm\\frames\\f.png", frameScale: "1", effectEnabled: false, effectPath: "D:\\fx\\a.mp4",
  overlayFolder: "D:\\overlays", backgroundFolder: "D:\\bg", outputFolder: "D:\\done", chromaKeyFile: "D:\\ck.txt",
  useGPU: true, gpuVideoCodec: "h264_nvenc", maxConcurrentProcesses: "2", cycleDays: "19", lastRenderAt: "2026-01-01T00:00:00.000Z",
  pexelsApiKey: "px-SECRET-123", proxy: "http://u:p@1.2.3.4:80", cookiesFile: "C:\\c.txt", dualFrameBgPath: "D:\\bg.png", dualFrameMainX: "40",
};

test("splitRenderSettings: thông số dùng chung đi lên, đường dẫn/khóa/GPU ở lại máy", () => {
  const { shared, local } = splitRenderSettings(FULL);
  for (const k of ["renderMode", "opacity", "chromaKeyColor", "bgBlur", "mainScale", "videoSpeed", "height", "y_offset", "dualFrameMainX", "frameEnabled"]) assert.ok(k in shared, `${k} phải dùng chung`);
  for (const k of ["overlayFolder", "backgroundFolder", "outputFolder", "chromaKeyFile", "framePath", "effectPath", "dualFrameBgPath", "useGPU", "gpuVideoCodec", "maxConcurrentProcesses", "pexelsApiKey", "proxy", "cookiesFile"]) {
    assert.ok(!(k in shared), `${k} KHÔNG được lên server`);
    assert.ok(k in local, `${k} phải ở lại máy`);
  }
});

test("splitRenderSettings: không bao giờ để lọt đường dẫn, khóa hay proxy kèm mật khẩu lên shared (kiểm trên TỪNG giá trị)", () => {
  const { shared } = splitRenderSettings({ ...FULL, opacity: "C:\\Users\\adm\\x", bgBlur: "http://u:p@1.2.3.4:80", mainScale: "AIzaSyA-1234567890123456789012345678901", height: "/home/adm/x/y" });
  for (const [k, v] of Object.entries(shared)) assert.ok(!isSecretLooking(v), `${k} chứa giá trị nhạy cảm: ${v}`);
  assert.ok(!("opacity" in shared) && !("bgBlur" in shared) && !("mainScale" in shared) && !("height" in shared), "giá trị trông như bí mật bị loại dù khóa nằm trong danh sách cho phép");
});

test("splitRenderSettings: khóa lạ (thêm sau này) mặc định ở lại máy, không tự lên server", () => {
  const { shared, local } = splitRenderSettings({ ...FULL, truongMoi: "abc", anotherNew: 5 });
  assert.ok(!("truongMoi" in shared) && !("anotherNew" in shared));
  assert.equal(local.truongMoi, "abc");
});

test("splitRenderSettings: giữ nguyên kiểu (boolean, số, chuỗi); đầu vào rác trả rỗng", () => {
  const { shared } = splitRenderSettings({ keepColorCrop: true, bgBlurEnabled: false, opacity: 0.7, renderMode: "crop" });
  assert.equal(shared.keepColorCrop, true); assert.equal(shared.bgBlurEnabled, false); assert.equal(shared.opacity, 0.7);
  for (const bad of [null, undefined, "x", 5, []]) assert.deepEqual(splitRenderSettings(bad), { shared: {}, local: {} });
});

test("splitRenderSettings: không sửa đối tượng gốc", () => {
  const before = JSON.stringify(FULL); splitRenderSettings(FULL);
  assert.equal(JSON.stringify(FULL), before);
});

test("mergeRenderSettings: phần dùng chung đè lên phần riêng cùng khóa, phần riêng của máy được giữ", () => {
  const local = { outputFolder: "D:\\done", opacity: "0.5", useGPU: true };
  const out = mergeRenderSettings(local, { opacity: "0.9", renderMode: "crop" });
  assert.equal(out.opacity, "0.9", "cấu hình chung thắng");
  assert.equal(out.renderMode, "crop");
  assert.equal(out.outputFolder, "D:\\done", "đường dẫn riêng của máy không bị mất");
  assert.equal(out.useGPU, true);
});

test("mergeRenderSettings: shared không được ghi đè khóa riêng của máy dù server gửi nhầm (đường dẫn, khóa API)", () => {
  const local = { outputFolder: "D:\\done", pexelsApiKey: "KEY-CUA-MAY", useGPU: false };
  const out = mergeRenderSettings(local, { outputFolder: "E:\\hacker", pexelsApiKey: "x", useGPU: true, opacity: "0.4" });
  assert.equal(out.outputFolder, "D:\\done"); assert.equal(out.pexelsApiKey, "KEY-CUA-MAY"); assert.equal(out.useGPU, false);
  assert.equal(out.opacity, "0.4");
});

test("mergeRenderSettings: đầu vào rác không làm hỏng, không sửa bản gốc", () => {
  const local = { a: 1 }; const before = JSON.stringify(local);
  assert.deepEqual(mergeRenderSettings(local, null), { a: 1 });
  assert.deepEqual(mergeRenderSettings(null, { opacity: "1" }), { opacity: "1" });
  assert.deepEqual(mergeRenderSettings(undefined, undefined), {});
  mergeRenderSettings(local, { opacity: "1" });
  assert.equal(JSON.stringify(local), before);
});

test("SHARED_RENDER_KEYS: không chứa khóa nào có vẻ là đường dẫn, khóa API hay proxy", () => {
  // "key" trần không dùng được: chromaKey* là xóa phông (thông số render), không phải khóa API. Chỉ bắt các dạng khóa bí mật thật.
  for (const k of SHARED_RENDER_KEYS) assert.ok(!/path|folder|file|apikey|api_key|secret|proxy|cookie|token|pass|gpu|codec|concurrent/i.test(k), `${k} có vẻ nhạy cảm/riêng máy`);
  for (const k of ["pexelsApiKey", "pixabayApiKey", "proxy", "cookiesFile", "outputFolder", "framePath", "gpuVideoCodec"]) assert.ok(!SHARED_RENDER_KEYS.includes(k), `${k} không được ở danh sách dùng chung`);
});

test("isSecretLooking: nhận ra đường dẫn, URL có mật khẩu, khóa Google/JWT; không nhầm số và tên kiểu render", () => {
  for (const v of ["C:\\a\\b", "D:/x/y", "/home/u/x", "\\\\server\\share", "http://u:p@h:80", "AIzaSyA-1234567890123456789012345678901", "eyJabc12345.eyJdef12345.sig123456"]) assert.ok(isSecretLooking(v), v);
  for (const v of ["0.7", 0.7, true, "chromaKey", "D4F9D7", "topTransparent", "", null, 220]) assert.ok(!isSecretLooking(v), String(v));
});

import { renderToBatchPatch, batchToRenderShared } from "../sheet/render-share.js";

test("renderToBatchPatch: gửi thông số mẻ và phần render dùng chung, không có đường dẫn/khóa", () => {
  const p = renderToBatchPatch(FULL);
  assert.ok(!("totalDays" in p)); assert.equal(p.videosPerDay, 5); assert.equal(p.cycleDays, 19);
  assert.equal(p.render.renderMode, "chromaKey");
  const text = JSON.stringify(p);
  for (const bad of ["outputFolder", "overlayFolder", "pexelsApiKey", "px-SECRET", "1.2.3.4", "h264_nvenc", "useGPU", "Users"]) assert.ok(!text.includes(bad), bad + " lọt vào dữ liệu gửi mẻ");
});

test("renderToBatchPatch: số ngoài khoảng bị kẹp, số rác thì bỏ qua (không gửi giá trị bịa)", () => {
  const p = renderToBatchPatch({ day: "9999", videos: "0", cycleDays: "abc", renderMode: "crop" });
  assert.ok(!("totalDays" in p)); assert.equal(p.videosPerDay, 1); assert.ok(!("cycleDays" in p));
  assert.deepEqual(renderToBatchPatch(null), { render: {} });
});

test("batchToRenderShared: ba thông số của mẻ đè lên, phần render dùng chung được áp, khóa riêng máy bị bỏ", () => {
  const out = batchToRenderShared({ totalDays: 19, videosPerDay: 3, cycleDays: 10, render: { renderMode: "crop", opacity: "0.4", outputFolder: "E:\\x", day: "99" } });
  assert.equal(out.day, "1", "ngày hiện tại lấy từ currentDay của mẻ (chưa có thì 1), không lấy từ render"); assert.equal(out.videos, "3"); assert.equal(out.cycleDays, "10");
  assert.equal(out.renderMode, "crop"); assert.equal(out.opacity, "0.4");
  assert.ok(!("outputFolder" in out));
});

test("batchToRenderShared: mẻ rác hoặc thiếu trường trả rỗng, không ném lỗi", () => {
  for (const bad of [null, undefined, "x", 5]) assert.deepEqual(batchToRenderShared(bad), {});
  assert.deepEqual(batchToRenderShared({ render: null }), { day: "1" }, "mẻ hợp lệ nhưng chưa có gì thì chỉ có ngày 1");
});

test("vòng đi vòng lại: đẩy lên mẻ rồi kéo xuống máy khác giữ nguyên thông số dùng chung, không đụng phần riêng máy", () => {
  const patch = renderToBatchPatch(FULL);
  const batch = { ...patch };
  const machine2 = { outputFolder: "F:\may2", useGPU: false, opacity: "0.1", renderMode: "topTransparent", day: "1" };
  const merged = mergeRenderSettings(machine2, batchToRenderShared(batch));
  assert.equal(merged.renderMode, "chromaKey"); assert.equal(merged.opacity, "0.7"); assert.equal(merged.day, "1");
  assert.equal(merged.outputFolder, "F:\may2"); assert.equal(merged.useGPU, false);
});

import { BATCH_RENDER_MODES, BATCH_MODE_FIELDS, BATCH_COMMON_FIELDS, buildBatchRender } from "../sheet/render-share.js";

test("mẻ: có đủ 6 kiểu render như tab Render, mỗi kiểu có trường riêng", () => {
  assert.deepEqual(BATCH_RENDER_MODES.map((m) => m.id), ["topTransparent", "chromaKey", "crop", "keepColor", "blurFrame", "dualFrame"]);
  for (const m of BATCH_RENDER_MODES) assert.ok(BATCH_MODE_FIELDS[m.id].length > 0, m.id);
});

test("mẻ: MỌI trường đều nằm trong danh sách dùng chung, không trường nào là đường dẫn/khóa, mặc định nằm trong khoảng", () => {
  const all = [...BATCH_COMMON_FIELDS, ...Object.values(BATCH_MODE_FIELDS).flat()];
  for (const f of all) {
    assert.ok(SHARED_RENDER_KEYS.includes(f.key), f.key + " thiếu trong SHARED_RENDER_KEYS");
    assert.ok(!isSecretLooking(f.def), f.key + " mặc định trông như bí mật");
    if (f.type === "num" || f.type === "int") assert.ok(f.min <= Number(f.def) && Number(f.def) <= f.max, f.key + " mặc định ngoài khoảng");
    if (f.type === "select") assert.ok(f.options.includes(f.def), f.key + " mặc định không thuộc lựa chọn");
  }
  const keys = all.map((f) => f.key); assert.equal(new Set(keys).size, keys.length, "trùng khóa giữa các kiểu");
});

test("buildBatchRender: chỉ giữ thông số của kiểu đang chọn + tốc độ; không lẫn thông số kiểu khác", () => {
  const r = buildBatchRender("chromaKey", { chromaKeyColor: "ff00aa", chromaKeySimilarity: "0.5", opacity: "0.9", bgBlur: "30", videoSpeed: "0.9" });
  assert.deepEqual(Object.keys(r).sort(), ["chromaKeyColor", "chromaKeySimilarity", "renderMode", "videoSpeed"]);
  assert.equal(r.renderMode, "chromaKey"); assert.equal(r.chromaKeyColor, "ff00aa"); assert.equal(r.chromaKeySimilarity, "0.5"); assert.equal(r.videoSpeed, "0.9");
});

test("buildBatchRender: giá trị rác/thiếu về mặc định, số bị kẹp trong khoảng, bool nhận nhiều dạng", () => {
  const r = buildBatchRender("blurFrame", { bgBlur: "999", mainScale: "abc", bgBlurEnabled: "true", frameEnabled: "no", effectBlend: "hack", videoSpeed: "5" });
  assert.equal(r.bgBlur, "50"); assert.equal(r.mainScale, "0.85"); assert.equal(r.bgBlurEnabled, true); assert.equal(r.frameEnabled, false);
  assert.equal(r.effectBlend, "normal"); assert.equal(r.videoSpeed, "1");
  assert.equal(buildBatchRender("crop", { height: "12.7" }).height, "13", "số nguyên được làm tròn");
  assert.equal(buildBatchRender("crop", { y_offset: "-5" }).y_offset, "0");
});

test("buildBatchRender: kiểu lạ/đầu vào rác về topTransparent với mặc định; không ném lỗi", () => {
  for (const [m, v] of [["khong-co", null], [undefined, undefined], [null, "x"], ["__proto__", {}], ["constructor", []]]) {
    const r = buildBatchRender(m, v); assert.equal(r.renderMode, "topTransparent"); assert.equal(r.opacity, "0.7"); assert.equal(r.videoSpeed, "0.95");
  }
});

test("buildBatchRender: màu hex chứa đường dẫn/URL bị loại; kết quả luôn qua được bộ lọc dùng chung", () => {
  assert.equal(buildBatchRender("chromaKey", { chromaKeyColor: "C:" + String.fromCharCode(92) + "x" + String.fromCharCode(92) + "y" }).chromaKeyColor, "D4F9D7");
  assert.equal(buildBatchRender("chromaKey", { chromaKeyColor: "http://u:p@h" }).chromaKeyColor, "D4F9D7");
  for (const m of BATCH_RENDER_MODES) {
    const r = buildBatchRender(m.id, {});
    const { shared } = splitRenderSettings(r);
    assert.deepEqual(Object.keys(shared).sort(), Object.keys(r).sort(), m.id + ": có khóa bị bộ lọc dùng chung loại");
  }
});

import { mergeBatchRender, batchBodyWithRender, batchRenderSchema } from "../sheet/render-share.js";

test("mergeBatchRender: giữ thông số kiểu khác đã lưu, đè kiểu đang sửa", () => {
  const existing = { renderMode: "crop", opacity: "0.4", bgBlur: "30", height: "300", chromaKeyColor: "AABBCC" };
  const out = mergeBatchRender(existing, "chromaKey", { chromaKeyColor: "112233", chromaKeySimilarity: "0.5" });
  assert.equal(out.renderMode, "chromaKey"); assert.equal(out.chromaKeyColor, "112233"); assert.equal(out.chromaKeySimilarity, "0.5");
  assert.equal(out.bgBlur, "30", "thông số của kiểu khác còn nguyên"); assert.equal(out.height, "300"); assert.equal(out.opacity, "0.4");
});

test("mergeBatchRender: phần đã lưu có đường dẫn/khóa thì bị loại (không lọt lại lên server)", () => {
  const out = mergeBatchRender({ outputFolder: "D:/x", pexelsApiKey: "k", opacity: "0.4" }, "topTransparent", {});
  assert.ok(!("outputFolder" in out) && !("pexelsApiKey" in out)); assert.equal(out.renderMode, "topTransparent");
  assert.deepEqual(Object.keys(mergeBatchRender(null, "crop", null)).includes("renderMode"), true);
});

test("batchBodyWithRender: có renderMode thì ghép render; không có thì không đụng tới render; dọn các khóa tạm", () => {
  const withMode = batchBodyWithRender({ name: "M", totalDays: 5, renderMode: "crop", renderValues: { height: "250" }, renderBase: { bgBlur: "25" } });
  assert.equal(withMode.name, "M"); assert.equal(withMode.render.renderMode, "crop"); assert.equal(withMode.render.height, "250"); assert.equal(withMode.render.bgBlur, "25");
  for (const k of ["renderMode", "renderValues", "renderBase"]) assert.ok(!(k in withMode), k);
  const noMode = batchBodyWithRender({ name: "M", warnDays: 3 });
  assert.ok(!("render" in noMode), "không gửi render thì server giữ nguyên"); assert.equal(noMode.warnDays, 3);
  for (const bad of [null, undefined, "x", 5, []]) assert.deepEqual(batchBodyWithRender(bad), {});
});

test("batchRenderSchema: đủ kiểu + trường; bản sao nên sửa đổi không làm hỏng dữ liệu gốc", () => {
  const s = batchRenderSchema();
  assert.equal(s.modes.length, 6); assert.ok(s.common.length >= 1); for (const m of s.modes) assert.ok(s.byMode[m.id].length > 0);
  s.byMode.crop[0].def = "HACK"; assert.notEqual(batchRenderSchema().byMode.crop[0].def, "HACK");
  assert.doesNotThrow(() => JSON.stringify(s));
});

import { nextBatchDay } from "../sheet/render-share.js";

test("SỬA ÁNH XẠ: ô 'day' của tab Render là NGÀY HIỆN TẠI của vòng, không phải số ngày mỗi vòng", () => {
  // Gửi lên mẻ: day KHÔNG được biến thành totalDays
  const p = renderToBatchPatch({ day: "7", videos: "4", cycleDays: "19", renderMode: "crop" });
  assert.ok(!("totalDays" in p), "day không phải số ngày của vòng");
  assert.equal(p.videosPerDay, 4); assert.equal(p.cycleDays, 19);
  assert.ok(!("day" in p.render), "ngày hiện tại thuộc về mẻ (currentDay), không đi theo phần dùng chung");
  // Kéo từ mẻ về: day = currentDay của mẻ, không phải totalDays
  const out = batchToRenderShared({ totalDays: 19, currentDay: 6, videosPerDay: 3, cycleDays: 10, render: { renderMode: "crop", day: "99" } });
  assert.equal(out.day, "6"); assert.equal(out.videos, "3"); assert.equal(out.cycleDays, "10");
  assert.equal(batchToRenderShared({ totalDays: 19, videosPerDay: 3 }).day, "1", "mẻ chưa có currentDay thì bắt đầu từ ngày 1");
});

test("nextBatchDay: tăng 1 mỗi lần render xong; hết vòng thì về 1 và báo sang vòng mới", () => {
  assert.deepEqual(nextBatchDay(1, 19), { day: 2, newRound: false });
  assert.deepEqual(nextBatchDay(18, 19), { day: 19, newRound: false });
  assert.deepEqual(nextBatchDay(19, 19), { day: 1, newRound: true });
  assert.deepEqual(nextBatchDay(25, 19), { day: 1, newRound: true }, "ngày vượt tổng số thì coi như hết vòng");
});

test("nextBatchDay: giá trị rác không làm hỏng, mặc định ngày 1 của vòng 19 ngày", () => {
  assert.deepEqual(nextBatchDay(undefined, undefined), { day: 2, newRound: false });
  assert.deepEqual(nextBatchDay("abc", "xyz"), { day: 2, newRound: false });
  assert.deepEqual(nextBatchDay(0, 5), { day: 2, newRound: false }, "ngày 0 coi là ngày 1");
  assert.deepEqual(nextBatchDay(-3, 5), { day: 2, newRound: false });
  assert.deepEqual(nextBatchDay(1, 1), { day: 1, newRound: true }, "vòng 1 ngày: mỗi lần render là một vòng mới");
  assert.deepEqual(nextBatchDay("3", "5"), { day: 4, newRound: false }, "chuỗi số vẫn đọc được");
});
