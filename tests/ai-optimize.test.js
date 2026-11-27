import test from "node:test";
import assert from "node:assert/strict";
import { optimizeVideo, buildThumbPrompt } from "../sheet/ai-optimize.js";
import { createChannelKeyStore } from "../sheet/ai-keys.js";
import { makeThumbViaProfile } from "../sheet/ai-thumb.js";

const mkFs = (files = {}) => { const f = { ...files }; return { f, exists: (p) => p in f, readText: (p) => f[p], unlink: (p) => { delete f[p]; }, rename: (a, b) => { f[b] = f[a]; delete f[a]; }, copy: (a, b) => { f[b] = f[a]; } }; };
const ch = { name: "KENH_A", gpmProfileId: "p1" };

test("optimizeVideo: không có khóa -> bỏ qua, không gọi AI", async () => {
  let called = 0;
  const r = await optimizeVideo({ channel: ch, title: "Gốc", deps: { getKey: () => "", generateTitle: async () => { called++; }, ...mkFs() } });
  assert.equal(r.skipped, "no-key"); assert.equal(r.title, ""); assert.equal(called, 0);
});

test("optimizeVideo: viết title mới từ title + mô tả cũ, rồi vẽ thumbnail mới theo ảnh cũ, giữ bản gốc .orig", async () => {
  const fs = mkFs({ "/o/v.description": "Mô tả cũ của video", "/o/v.jpg": "OLD" });
  let seen = null, thumbArgs = null;
  const r = await optimizeVideo({ channel: ch, title: "Gốc", descriptionPath: "/o/v.description", thumbPath: "/o/v.jpg", deps: {
    ...fs, getKey: () => "KEY12345",
    generateTitle: async (o) => { seen = o; return { ok: true, title: "Title mới hay hơn" }; },
    makeThumb: async (o) => { thumbArgs = o; fs.f[o.outPath] = "NEW"; },
  } });
  assert.equal(r.title, "Title mới hay hơn"); assert.equal(r.thumbChanged, true);
  assert.equal(seen.fileTitle, "Gốc"); assert.equal(seen.description, "Mô tả cũ của video"); assert.equal(seen.apiKey, "KEY12345");
  assert.equal(thumbArgs.title, "Title mới hay hơn"); assert.equal(thumbArgs.referencePath, "/o/v.jpg");
  assert.equal(fs.f["/o/v.jpg"], "NEW", "thumbnail mới thay vào đúng tên cũ"); assert.equal(fs.f["/o/v.orig.jpg"], "OLD"); assert.ok(!("/o/v.description" in fs.f), "file mô tả thừa được dọn");
});

test("optimizeVideo: AI title lỗi/trùng gốc -> giữ nguyên, không vẽ thumbnail", async () => {
  let thumb = 0;
  const deps = { ...mkFs({ "/o/v.jpg": "OLD" }), getKey: () => "KEY12345", makeThumb: async () => { thumb++; } };
  for (const gen of [async () => ({ ok: false, error: "quota" }), async () => ({ ok: true, title: "Gốc" }), async () => { throw new Error("sập"); }]) {
    const r = await optimizeVideo({ channel: ch, title: "Gốc", thumbPath: "/o/v.jpg", deps: { ...deps, generateTitle: gen } });
    assert.equal(r.title, ""); assert.equal(r.thumbChanged, false);
  }
  assert.equal(thumb, 0);
});

test("optimizeVideo: vẽ thumbnail lỗi (chưa đăng nhập Flow...) -> vẫn dùng title mới, thumbnail gốc còn nguyên, ảnh tạm được dọn", async () => {
  const fs = mkFs({ "/o/v.jpg": "OLD", "/o/v.ai-new.jpg": "DO" });
  const r = await optimizeVideo({ channel: ch, title: "Gốc", thumbPath: "/o/v.jpg", deps: { ...fs, getKey: () => "KEY12345", generateTitle: async () => ({ ok: true, title: "Mới" }), makeThumb: async () => { throw new Error("chưa đăng nhập Flow"); } } });
  assert.equal(r.title, "Mới"); assert.equal(r.thumbChanged, false); assert.equal(fs.f["/o/v.jpg"], "OLD"); assert.ok(!("/o/v.ai-new.jpg" in fs.f));
});

test("optimizeVideo: treo thì hết giờ và bỏ qua; ngoại lệ bất ngờ không ném ra; log không chứa khóa", async () => {
  const logs = [];
  const r = await optimizeVideo({ channel: ch, title: "Gốc", timeouts: { title: 20 }, deps: { ...mkFs(), log: (m) => logs.push(m), getKey: () => "KHOA-BI-MAT-1", generateTitle: () => new Promise(() => {}) } });
  assert.equal(r.title, "");
  const boom = await optimizeVideo({ channel: ch, title: "Gốc", deps: { getKey: () => { throw new Error("hỏng"); } } });
  assert.equal(boom.skipped, "error");
  assert.ok(!logs.join("\n").includes("KHOA-BI-MAT-1"));
});

test("buildThumbPrompt: không có ảnh mẫu -> giữ phong cách ảnh gốc, đổi nội dung theo title", () => {
  const p = buildThumbPrompt('Title "mới"'); assert.match(p, /same art style/i); assert.ok(p.includes("mới"));
});
test("buildThumbPrompt: có ảnh mẫu -> dùng làm gợi ý bố cục/phong cách, nhân vật từ ảnh gốc, không copy y hệt", () => {
  const p = buildThumbPrompt("Tiêu đề", "", true);
  assert.match(p, /GUIDE for the overall layout/i);
  assert.match(p, /FIRST reference image/i);
  assert.match(p, /not an exact duplicate/i);
});
test("buildThumbPrompt: luôn cấm thêm chữ tiếng Anh/bản dịch/phụ đề ngoài title", () => {
  for (const p of [buildThumbPrompt("T", "", true), buildThumbPrompt("T", "", false)]) {
    assert.match(p, /do NOT add any English text/i);
    assert.match(p, /same language as the title/i);
  }
});
test("buildThumbPrompt: rule riêng của kênh luôn được chèn vào", () => {
  assert.match(buildThumbPrompt("T", "chữ bên trái, nhân vật bên phải", true), /chữ bên trái, nhân vật bên phải/);
  assert.match(buildThumbPrompt("T", "ít chữ", false), /ít chữ/);
});

// ---- khóa theo kênh
const mkKeys = (can = true) => { const m = new Map(); return { m, ks: createChannelKeyStore({ io: { read: (n) => m.get(n) ?? null, write: (n, d) => m.set(n, d) }, crypto: { available: () => can, encrypt: (t) => "ENC:" + Buffer.from(t).reverse().toString("base64"), decrypt: (t) => Buffer.from(t.slice(4), "base64").reverse().toString() } }) }; };
test("ai-keys: lưu mã hóa theo từng kênh, không lộ khóa thô, view chỉ có 4 ký tự cuối", () => {
  const { m, ks } = mkKeys();
  assert.equal(ks.set("A", "KHOA-RIENG-A-1234").ok, true); ks.set("B", "KHOA-RIENG-B-9999");
  assert.equal(ks.get("A"), "KHOA-RIENG-A-1234"); assert.equal(ks.get("B"), "KHOA-RIENG-B-9999"); assert.equal(ks.get("C"), "");
  assert.ok(!JSON.stringify([...m.values()]).includes("KHOA-RIENG")); assert.deepEqual(ks.view("A"), { hasKey: true, keyHint: "…1234" });
  ks.clear("A"); assert.equal(ks.get("A"), ""); ks.prune(["Z"]); assert.equal(ks.get("B"), "");
});
test("ai-keys: reserved slots (__xxx__) survive prune, normal keys not in list are removed", () => {
  const { ks } = mkKeys();
  // Set up: normal key B, reserved key __trend-ai__
  ks.set("B", "KHOA-RIENG-B-9999");
  ks.set("__trend-ai__", "TREND-KEY-12345678");
  assert.equal(ks.get("B"), "KHOA-RIENG-B-9999");
  assert.equal(ks.get("__trend-ai__"), "TREND-KEY-12345678");
  // Prune with list that doesn't include B or __trend-ai__
  ks.prune(["Z"]);
  // Normal key B should be removed
  assert.equal(ks.get("B"), "", "normal key B should be pruned");
  // Reserved key __trend-ai__ should survive
  assert.equal(ks.get("__trend-ai__"), "TREND-KEY-12345678", "reserved key __trend-ai__ should survive prune");
});
test("ai-keys: khóa rác hoặc không mã hóa được thì KHÔNG lưu", () => {
  const { ks } = mkKeys(); assert.equal(ks.set("A", "ngan").ok, false); assert.equal(ks.set("A", "co khoang trang 123456").ok, false); assert.equal(ks.set("", "KHOA-HOP-LE-123").ok, false);
  const no = mkKeys(false).ks; assert.equal(no.set("A", "KHOA-HOP-LE-123").ok, false); assert.equal(no.get("A"), "");
});

// ---- vẽ thumbnail trong profile GPM
test("makeThumbViaProfile: nối vào profile qua CDP, gửi ảnh cũ làm tham chiếu, rồi NGẮT KẾT NỐI (không đóng profile)", async () => {
  const ev = []; let gen = null;
  const browser = { disconnect: async () => ev.push("disconnect") };
  const out = await makeThumbViaProfile({ gpmHost: "h", profileId: "p1", title: "Mới", referencePath: "/o/v.jpg", outPath: "/o/n.jpg", deps: {
    startProfile: async () => "127.0.0.1:9", connect: async (a) => { ev.push("connect " + a); return browser; },
    generate: async (b, params, send, opts) => { gen = params; await opts.write(Buffer.from("IMG")); return { ok: true }; },
    writeFile: (f) => ev.push("write " + f),
  } });
  assert.equal(out, "/o/n.jpg"); assert.deepEqual(ev, ["connect 127.0.0.1:9", "write /o/n.jpg", "disconnect"]);
  assert.equal(gen.aspectRatio, "16:9"); assert.equal(gen.referenceImages[0].filePath, "/o/v.jpg"); assert.equal(gen.referenceImages[0].mime, "image/jpeg");
});
test("makeThumbViaProfile: chưa đăng nhập Flow thì báo lỗi rõ và vẫn ngắt kết nối; thiếu profile thì báo ngay", async () => {
  const ev = [];
  await assert.rejects(makeThumbViaProfile({ gpmHost: "h", profileId: "p1", title: "x", referencePath: "/a.png", outPath: "/b.jpg", deps: {
    startProfile: async () => "a", connect: async () => ({ disconnect: async () => ev.push("d") }),
    generate: async (b, p, send) => { send({ step: "need_login", message: "Bạn chưa đăng nhập" }); return { ok: false }; }, writeFile() {},
  } }), /đăng nhập/);
  assert.deepEqual(ev, ["d"]);
  await assert.rejects(makeThumbViaProfile({ gpmHost: "h", profileId: "", title: "x", referencePath: "/a.png", outPath: "/b", deps: {} }), /GPM Profile/);
});

test("optimizeVideo: runner truyền kênh có `sheetName` (không có `name`) vẫn tìm đúng khóa theo tên kênh (lỗi thật đã gặp khi chạy app)", async () => {
  let keyFor = null;
  const r = await optimizeVideo({ channel: { sheetName: "TRUYEN_TRANH_02" }, title: "Gốc", deps: { getKey: (n) => { keyFor = n; return n === "TRUYEN_TRANH_02" ? "KEY12345" : ""; }, generateTitle: async () => ({ ok: true, title: "Mới" }), ...mkFs() } });
  assert.equal(keyFor, "TRUYEN_TRANH_02"); assert.equal(r.title, "Mới");
});

test("optimizeVideo: chuẩn hóa cỡ thumbnail trước khi thay; chuẩn hóa lỗi thì vẫn dùng ảnh AI nguyên bản", async () => {
  const mk = (norm) => { const fs = mkFs({ "/o/v.jpg": "OLD" }); return { fs, deps: { ...fs, getKey: () => "KEY12345", generateTitle: async () => ({ ok: true, title: "Mới" }), makeThumb: async (o) => { fs.f[o.outPath] = "RAW"; }, normalizeThumb: norm } }; };
  const a = mk(async (p) => { a.fs.f[p] = "1280x720"; });
  assert.equal((await optimizeVideo({ channel: ch, title: "Gốc", thumbPath: "/o/v.jpg", deps: a.deps })).thumbChanged, true); assert.equal(a.fs.f["/o/v.jpg"], "1280x720");
  const b = mk(async () => { throw new Error("sharp lỗi"); });
  assert.equal((await optimizeVideo({ channel: ch, title: "Gốc", thumbPath: "/o/v.jpg", deps: b.deps })).thumbChanged, true); assert.equal(b.fs.f["/o/v.jpg"], "RAW");
});

test("chuẩn hóa thumbnail bằng sharp qua buffer chạy được với tên file tiếng Nhật rất dài (lỗi thật khi chạy app)", async () => {
  const fsr = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), sharp = (await import("sharp")).default;
  const name = "【漫画】過去を隠して陰キャ教師として過ごしていた俺。同僚がクズすぎたので本気を出した結果→教え子に猛アタックされてしまう【胸キュン漫画】【恋愛漫画】【AI漫画】【総集編】.ai-new.jpg";
  const f = path.join(os.tmpdir(), name);
  fsr.writeFileSync(f, await sharp({ create: { width: 1376, height: 768, channels: 3, background: "#c33" } }).jpeg().toBuffer());
  try {
    fsr.writeFileSync(f, await sharp(fsr.readFileSync(f)).resize(1280, 720, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer());
    const m = await sharp(fsr.readFileSync(f)).metadata();
    assert.deepEqual([m.width, m.height], [1280, 720]);
  } finally { fsr.unlinkSync(f); }
});
