import test from "node:test";
import assert from "node:assert/strict";
import { scrubText, lastMeaningfulLine, summarizeResult, channelResultEvent, createTaskTracker, taskLabel } from "../sheet/task-monitor.js";

// ---------------- scrubText: KHÔNG được lộ bí mật khi gửi lên web ----------------
test("scrubText: proxy kèm user:pass trong URL bị che, giữ host:port", () => {
  const out = scrubText("ERROR: Unable to connect to proxy http://bob:SuperSecret123@10.0.0.5:8080 timeout");
  assert.ok(!out.includes("SuperSecret123") && !out.includes("bob:"), out);
  assert.match(out, /10\.0\.0\.5:8080/);
  assert.match(scrubText("socks5://u:p@1.2.3.4:1080"), /socks5:\/\/\*\*\*@1\.2\.3\.4:1080/);
});

test("scrubText: proxy kiểu ip:port:user:pass (định dạng GPM) bị che", () => {
  const out = scrubText("proxy 130.22.183.69:56856:tttttd:MyPassword lỗi");
  assert.ok(!out.includes("MyPassword") && !out.includes("tttttd"), out);
  assert.match(out, /130\.22\.183\.69:56856:\*\*\*:\*\*\*/);
  assert.ok(!scrubText("host.example.com:9000:user1:pw1").includes("pw1"));
});

test("scrubText: email Gmail bị che (cột tk có thể lọt vào lỗi đăng nhập)", () => {
  const out = scrubText("không đăng nhập được tài khoản someone@gmail.com: sai mật khẩu");
  assert.ok(!out.includes("someone@gmail.com"), out);
  assert.match(out, /\*\*\*@\*\*\*/);
});

test("scrubText: đường dẫn Windows tuyệt đối chỉ còn tên file (không lộ tên người dùng máy)", () => {
  const out = scrubText("ENOENT: no such file C:\\Users\\adm\\Videos\\kenh1\\overlays\\clip.mp4 not found");
  assert.ok(!out.includes("adm") && !out.includes("Users") && !out.includes("overlays"), out);
  assert.match(out, /clip\.mp4/);
  assert.ok(!scrubText("D:\\Code\\vid-master\\render.js:42").includes("Code"));
});

test("scrubText: đường dẫn Unix tuyệt đối dài cũng được rút gọn", () => {
  const out = scrubText("open /home/alice/projects/vid/output/a.mp4 failed");
  assert.ok(!out.includes("alice") && !out.includes("projects"), out);
  assert.match(out, /a\.mp4/);
});

test("scrubText: token bot Telegram / API key / token máy dài bị che", () => {
  assert.ok(!scrubText("token 123456789:AAH-fakeTokenForTestingOnly_0123456789ab sai").includes("AAH-fake"));
  assert.ok(!scrubText("key=AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe").includes("AIzaSy"));
  assert.ok(!scrubText(`Authorization: Bearer vmt_${"a1b2".repeat(16)}`).includes("a1b2a1b2"));
});

test("scrubText: giữ nguyên câu lỗi bình thường, không phá nội dung vô hại", () => {
  assert.equal(scrubText("ffmpeg thoát mã 1: Invalid data found when processing input"), "ffmpeg thoát mã 1: Invalid data found when processing input");
  assert.equal(scrubText("Không thấy nút đổi thumbnail"), "Không thấy nút đổi thumbnail");
  assert.equal(scrubText("[Kênh A] ❌ hết slot ngày mai"), "[Kênh A] ❌ hết slot ngày mai");
  assert.equal(scrubText("Video 4/10 · 75% xong"), "Video 4/10 · 75% xong");
});

test("scrubText: cắt độ dài, bỏ mã màu terminal và ký tự điều khiển, null/undefined an toàn", () => {
  assert.equal(scrubText("\u001b[31mlỗi đỏ\u001b[0m"), "lỗi đỏ");
  assert.ok(scrubText("x".repeat(1000)).length <= 220);
  assert.ok(scrubText("x".repeat(1000)).endsWith("…"));
  assert.equal(scrubText(null), "");
  assert.equal(scrubText(undefined), "");
  assert.equal(scrubText("a\u0000b\u0007c"), "a b c");
});

test("scrubText: kết quả rỗng/bí mật thuần không làm vỡ", () => {
  assert.equal(scrubText("   "), "");
  assert.doesNotThrow(() => scrubText({ toString() { return "obj http://u:p@h:1"; } }));
});

test("lastMeaningfulLine: bỏ qua stack trace, lấy dòng giải thích lỗi", () => {
  const stderr = "node:internal/modules/run_main:1\n    throw err;\n    ^\n\nError: Cannot find module 'sharp'\n    at Module._resolve (node:internal/x:1:1)\n    at foo (file.js:2:3)\n\nNode.js v24.1.0";
  assert.equal(lastMeaningfulLine(stderr), "Error: Cannot find module 'sharp'");
  assert.equal(lastMeaningfulLine(""), "");
  assert.equal(lastMeaningfulLine(null), "");
});

// ---------------- summarizeResult ----------------
test("summarizeResult: tất cả kênh thành công -> ok, có số đếm", () => {
  const r = summarizeResult({ success: true, total: 8, ok: 8, fail: 0, skipped: 0 });
  assert.deepEqual([r.outcome, r.summary], ["ok", "8/8 kênh thành công"]);
  assert.deepEqual(r.counts, { total: 8, ok: 8, fail: 0, skipped: 0 });
});

test("summarizeResult: có kênh lỗi mà vẫn có kênh thành công -> partial; toàn lỗi -> error", () => {
  const p = summarizeResult({ success: true, total: 8, ok: 5, fail: 2, skipped: 1 });
  assert.equal(p.outcome, "partial"); assert.match(p.summary, /5\/8 thành công, 2 lỗi, 1 bỏ qua/);
  const e = summarizeResult({ success: true, total: 3, ok: 0, fail: 3, skipped: 0 });
  assert.equal(e.outcome, "error"); assert.match(e.summary, /3\/3 kênh lỗi/);
});

test("summarizeResult: chỉ có bỏ qua (không ok không lỗi) vẫn là ok, không phải lỗi", () => {
  assert.equal(summarizeResult({ success: true, total: 2, ok: 0, fail: 0, skipped: 2 }).outcome, "ok");
});

test("summarizeResult: lỗi script -> lấy dòng lỗi thật, đã lọc đường dẫn/bí mật", () => {
  const r = summarizeResult({ success: false, code: 1, error: "Error: lỗi mở C:\\Users\\adm\\a.mp4 qua http://u:pw@1.1.1.1:80\n    at x (y.js:1:1)" });
  assert.equal(r.outcome, "error");
  assert.ok(!r.summary.includes("adm") && !r.summary.includes("pw@"), r.summary);
});

test("summarizeResult: dừng theo yêu cầu -> skipped; thiếu dữ liệu -> mặc định ok không vỡ", () => {
  assert.equal(summarizeResult({ success: true }, { stopped: true }).outcome, "skipped");
  assert.equal(summarizeResult(null).outcome, "ok");
  assert.equal(summarizeResult(undefined).summary, "Hoàn tất");
});

test("summarizeResult: runner trả error trong object nhưng không có success=false vẫn là lỗi", () => {
  assert.equal(summarizeResult({ error: "boom" }).outcome, "error");
});

// ---------------- sự kiện từng kênh ----------------
test("channelResultEvent: ok -> success, skip -> info, error -> error; có tên tác vụ + tên kênh", () => {
  const ok = channelResultEvent("automation:change-thumb", { id: "p1", name: "Kênh A" }, { status: "ok" });
  assert.deepEqual([ok.level, ok.kind, ok.channel], ["success", "task", "Kênh A"]);
  assert.match(ok.message, /Đổi thumbnail: Kênh A xong/);
  assert.equal(channelResultEvent("automation:schedule", { name: "K" }, { status: "skip", message: "đã dừng" }).level, "info");
  const er = channelResultEvent("automation:schedule", { name: "K" }, { status: "error", message: "hết slot" });
  assert.equal(er.level, "error"); assert.match(er.message, /Lên lịch đăng: K lỗi · hết slot/);
});

test("channelResultEvent: lỗi chứa proxy/email/đường dẫn thì bị lọc; thiếu tên dùng id", () => {
  const e = channelResultEvent("automation:login", { id: "gpm-77" }, { status: "error", message: "login a@gmail.com qua http://u:p@2.2.2.2:1 ở C:\\Users\\x\\f.txt" });
  assert.ok(!/a@gmail|u:p@|Users/.test(e.message), e.message);
  assert.equal(e.channel, "gpm-77");
});

test("channelResultEvent: tên kênh chứa ký tự lạ/HTML được giữ nguyên chuỗi (web tự escape)", () => {
  assert.equal(channelResultEvent("automation:schedule", { name: "<b>x</b>" }, { status: "ok" }).channel, "<b>x</b>");
});

test("taskLabel: có tên tiếng Việt cho tác vụ đã biết, tác vụ lạ không làm vỡ", () => {
  assert.equal(taskLabel("render.js"), "Render video");
  assert.equal(taskLabel("automation:schedule"), "Lên lịch đăng");
  assert.equal(taskLabel("la-hoac.js"), "la-hoac");
  assert.equal(taskLabel(undefined), "Tác vụ");
});

// ---------------- tracker ----------------
const mk = () => { const sent = []; let t = 1000; return { sent, tr: createTaskTracker({ emit: (m) => sent.push(m), now: () => (t += 1000) }) }; };

test("tracker: start -> progress -> end gửi đúng thứ tự, có đồng hồ", () => {
  const { sent, tr } = mk();
  const id = tr.start("automation:change-thumb", { total: 3 });
  tr.progress(id, { channel: "A" }); tr.progress(id, { channel: "B" });
  const end = tr.finish(id, { success: true, total: 3, ok: 2, fail: 1, skipped: 0 });
  assert.deepEqual(sent.map((m) => m.phase), ["start", "progress", "progress", "end"]);
  assert.deepEqual([sent[2].done, sent[2].total, sent[2].channel], [2, 3, "B"]);
  assert.equal(end.outcome, "partial"); assert.equal(end.label, "Đổi thumbnail");
  assert.ok(end.endedAt > end.startedAt);
  assert.equal(tr.isBusy(), false);
});

test("tracker: chạy nhiều tác vụ cùng lúc, mỗi cái có id riêng, kết thúc cái nào gỡ cái đó", () => {
  const { tr } = mk();
  const a = tr.start("render.js"), b = tr.start("download.js");
  assert.notEqual(a, b); assert.equal(tr.list().length, 2); assert.equal(tr.isBusy(), true);
  tr.finish(a, { success: true });
  assert.deepEqual(tr.list().map((t) => t.key), ["download.js"]);
});

test("tracker: kết thúc hai lần hoặc id lạ không ném lỗi, không gửi trùng", () => {
  const { sent, tr } = mk();
  const id = tr.start("render.js"); tr.finish(id, { success: true });
  assert.equal(tr.finish(id, { success: true }), null);
  assert.equal(tr.finish("khong-co", {}), null);
  tr.progress("khong-co");
  assert.equal(sent.filter((m) => m.phase === "end").length, 1);
});

test("tracker: emit ném lỗi KHÔNG được làm hỏng tác vụ thật", () => {
  const tr = createTaskTracker({ emit: () => { throw new Error("mạng chết"); } });
  assert.doesNotThrow(() => { const id = tr.start("render.js"); tr.progress(id); tr.finish(id, { success: true }); });
});

test("tracker: abortAll (tắt app) đóng mọi tác vụ dở bằng kết quả lỗi", () => {
  const { sent, tr } = mk();
  tr.start("render.js"); tr.start("download.js");
  tr.abortAll();
  assert.equal(tr.isBusy(), false);
  const ends = sent.filter((m) => m.phase === "end");
  assert.equal(ends.length, 2); assert.ok(ends.every((e) => e.outcome === "error" && /đóng/.test(e.summary)));
});

// ---------------- Chính sách: tác vụ đụng tài khoản KHÔNG được báo lên web ----------------
import { UNTRACKED_TASKS, isTrackedTask, TASK_LABELS } from "../sheet/task-monitor.js";
import { sheetEventToMonitor, sheetEventToProgress } from "../sheet/monitor-agent.js";

test("đăng nhập kênh, tạo channel, tự động hóa theo Sheet KHÔNG được theo dõi", () => {
  assert.deepEqual([...UNTRACKED_TASKS].sort(), ["automation:create-channel", "automation:login", "sheet-auto:run"]);
  for (const k of UNTRACKED_TASKS) assert.equal(isTrackedTask(k), false, k);
});

test("đổi thumbnail, lên lịch, render, tải video vẫn được theo dõi", () => {
  for (const k of ["automation:change-thumb", "automation:schedule", "render.js", "download.js"]) assert.equal(isTrackedTask(k), true, k);
});

test("danh sách CHO PHÉP: tác vụ lạ chưa đăng ký mặc định KHÔNG bị gửi đi", () => {
  assert.equal(isTrackedTask("automation:tinh-nang-moi"), false);
  assert.equal(isTrackedTask("toString"), false, "không bị đánh lừa bởi thuộc tính của Object");
  assert.equal(isTrackedTask(undefined), false);
});

test("không tác vụ nào vừa nằm trong danh sách theo dõi vừa nằm trong danh sách cấm", () => {
  for (const k of UNTRACKED_TASKS) assert.ok(!(k in TASK_LABELS), k);
});

// ---------------- Luồng Sheet cũng phải lọc bí mật ----------------
const LEAKY = String.raw`lỗi qua http://bob:Hunter2xyz@10.0.0.5:8080 cho a@gmail.com tại C:\Users\adm\x\clip.mp4`;
const clean = (s) => !/Hunter2xyz|bob:|a@gmail|Users|adm/.test(s);

test("luồng Sheet: lỗi upload/tải/render chứa proxy, email, đường dẫn bị lọc trước khi lên web", () => {
  const up = sheetEventToMonitor({ type: "upload-status", channel: "K", status: `❌ lỗi: ${LEAKY}`, title: "T" });
  assert.ok(clean(up.message), up.message); assert.match(up.message, /^❌/);
  const er = sheetEventToMonitor({ type: "error", channel: "K", message: LEAKY });
  assert.ok(clean(er.message), er.message);
  const pr = sheetEventToProgress({ type: "error", channel: "K", url: "https://youtu.be/aaaaaaaaaaa", message: LEAKY });
  assert.ok(clean(pr.detail), pr.detail);
  const pu = sheetEventToProgress({ type: "upload-status", channel: "K", url: "u", status: `❌ lỗi: ${LEAKY}` });
  assert.ok(clean(pu.detail), pu.detail);
});

test("luồng Sheet: tiêu đề video chứa bí mật cũng bị lọc; trạng thái vẫn nhận ra được", () => {
  const p = sheetEventToProgress({ type: "channel-status", channel: "K", url: "u", status: "đang render", title: "xem http://u:pw@1.2.3.4:80/a" });
  assert.ok(!/pw@/.test(p.title), p.title);
  assert.equal(p.stage, "render");
  assert.equal(sheetEventToMonitor({ type: "upload-status", channel: "K", status: "✅ lên lịch 16/06/2026 08:00" }).level, "success");
  assert.equal(sheetEventToMonitor({ type: "upload-status", channel: "K", status: "⏸ chờ: hết slot ngày mai" }).level, "warning");
});

test("luồng Sheet: tên kênh bình thường và dấu hiệu ✅❌⏸ không bị phá", () => {
  const e = sheetEventToMonitor({ type: "upload-status", channel: "Nhạc Lofi Chill", status: "✅ lên lịch 16/06/2026 08:00", title: "Lofi #212" });
  assert.equal(e.channel, "Nhạc Lofi Chill");
  assert.equal(e.message, "✅ lên lịch 16/06/2026 08:00 · Lofi #212");
});

// ---------------- Mật khẩu viết trong câu lỗi (nhiều kiểu) ----------------
test("scrubText: mật khẩu/2FA đi kèm từ khóa bị che ở MỌI kiểu viết thường gặp", () => {
  const hidden = [
    ["lỗi đăng nhập mật khẩu Hunter2xyz proxy", "Hunter2xyz"], ["wrong password Hunter2xyz for user", "Hunter2xyz"],
    ["pass=Hunter2xyz", "Hunter2xyz"], ["pwd: Hunter2xyz", "Hunter2xyz"], ['{"password":"Hunter2xyz"}', "Hunter2xyz"],
    ["yt-dlp --password Hunter2xyz --user bobby", "Hunter2xyz"], ["yt-dlp --password Hunter2xyz --user bobby", "bobby"],
    ["--proxy-password=Hunter2xyz", "Hunter2xyz"], ["sai mã 2FA JBSWY3DPEHPK3PXP", "JBSWY3DPEHPK3PXP"],
    ["otp: 123456 hết hạn", "123456"], ["secret JBSWY3DPEHPK3PXP không hợp lệ", "JBSWY3DPEHPK3PXP"], ["mật khẩu P@ss!w0rd sai", "P@ss"],
  ];
  for (const [text, secret] of hidden) assert.ok(!scrubText(text).includes(secret), `${text} -> ${scrubText(text)}`);
});

test("scrubText: câu lỗi thường có chữ 'mật khẩu'/'password'/'token' KHÔNG bị phá (vẫn đọc được trên web)", () => {
  for (const s of ["mật khẩu sai", "wrong password for user", "sai mật khẩu hoặc tài khoản bị khóa", "password incorrect", "hết token quota hôm nay",
    "Token không đúng định dạng", "secret key không hợp lệ", "YouTube yêu cầu xác minh mã 2FA", "chờ 74s trước khi tải", "hết slot ngày mai"]) {
    assert.equal(scrubText(s), s);
  }
});
