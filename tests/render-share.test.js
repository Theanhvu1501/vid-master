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
