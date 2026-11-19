// Quản lý proxy của profile GPM: xem (ẩn mật khẩu), kiểm tra sống/chết, gán/xoá hàng loạt.
// Mật khẩu proxy KHÔNG BAO GIỜ ra log hay giao diện — chỉ hiện dạng scheme://host:port.

import { spawn } from "child_process";
import pLimit from "p-limit";
import { normalizeProxy } from "./proxy.js";
import { listGpmProfilesFull, updateGpmProfileProxy } from "./gpm-client.js";
import { checkCancelled } from "./youtube-automation.js";

// "socks5://host:port:user:pass" (kiểu GPM) hoặc mọi dạng normalizeProxy hiểu -> thành phần.
export function parseProxy(raw) {
  const url = normalizeProxy(raw); // ném lỗi nếu không hợp lệ
  const m = url.match(/^([a-z0-9]+):\/\/(?:(.*)@)?([^:@/]+):(\d+)$/i);
  if (!m) throw new Error("Proxy không hợp lệ");
  const auth = m[2] ?? "";
  const i = auth.indexOf(":");
  return {
    scheme: m[1].toLowerCase(), host: m[3], port: m[4],
    user: auth ? (i < 0 ? auth : auth.slice(0, i)) : "",
    pass: auth && i >= 0 ? auth.slice(i + 1) : "",
  };
}

// Dạng an toàn để hiển thị: bỏ user/pass.
export function maskProxy(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try { const p = parseProxy(s); return `${p.scheme}://${p.host}:${p.port}`; }
  catch { return "(không đọc được)"; }
}

// Đổi mọi dạng proxy sang dạng GPM lưu: scheme://host:port[:user:pass]. Rỗng -> "".
export function toGpmProxy(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const p = parseProxy(t); // ném lỗi nếu sai
  return `${p.scheme}://${p.host}:${p.port}${p.user ? `:${p.user}:${p.pass}` : ""}`;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const cfgQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Kiểm tra proxy bằng curl (hỗ trợ cả socks5): truy cập dịch vụ báo IP qua proxy.
// Cấu hình đưa qua stdin (-K -) để user/pass không lộ trong danh sách tiến trình.
export function checkProxy(raw, { timeoutSec = 15, url = "https://api.ipify.org", spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = parseProxy(raw); } catch (e) { return resolve({ ok: false, error: e.message }); }
    if (/[\r\n]/.test(p.user + p.pass)) return resolve({ ok: false, error: "Proxy chứa ký tự xuống dòng" });

    const scheme = p.scheme === "socks5" ? "socks5h" : p.scheme; // socks5h: phân giải DNS qua proxy
    const cfg = [
      `proxy = ${cfgQuote(`${scheme}://${p.host}:${p.port}`)}`,
      p.user ? `proxy-user = ${cfgQuote(`${p.user}:${p.pass}`)}` : null,
      `url = ${cfgQuote(url)}`, "silent", "show-error", `max-time = ${timeoutSec}`,
    ].filter(Boolean).join("\n") + "\n";

    const started = Date.now();
    let out = "", err = "", done = false;
    const scrub = (s) => [p.user, p.pass].filter(Boolean).reduce((t, x) => t.split(x).join("***"), s);
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };

    let child;
    try { child = spawnFn("curl", ["-K", "-"], { windowsHide: true }); }
    catch (e) { return resolve({ ok: false, error: `không chạy được curl: ${e.message}` }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, error: "quá thời gian chờ" }); }, (timeoutSec + 5) * 1000);

    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => finish({ ok: false, error: `không chạy được curl: ${e.message}` }));
    child.on("close", (code) => {
      const ip = out.trim();
      if (code === 0 && IPV4.test(ip)) return finish({ ok: true, ip, ms: Date.now() - started });
      finish({ ok: false, error: scrub((err.trim().split("\n")[0] || `curl thoát mã ${code}`).replace(/^curl:\s*/, "")) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(cfg);
  });
}

// ----- Chạy cho các profile đã chọn (chạy ở main process, log đẩy về UI) -----

export async function runProxyCheck({ gpmHost, profiles, concurrency = 5, onLog, checkFn = checkProxy }) {
  const log = onLog || console.log;
  if (!profiles?.length) throw new Error("Chưa chọn profile nào");
  const all = await listGpmProfilesFull(gpmHost);
  const byId = new Map(all.map((p) => [p.id, p]));
  const limit = pLimit(Math.max(1, parseInt(concurrency, 10) || 5));
  const n = { ok: 0, dead: 0, none: 0 };

  await Promise.all(profiles.map((sel) => limit(async () => {
    const prof = byId.get(sel.id);
    const raw = prof?.rawProxy || "";
    if (!raw) { n.none++; log(`[${sel.name}] — chưa có proxy`); return; }
    const r = await checkFn(raw);
    if (r.ok) { n.ok++; log(`[${sel.name}] ✅ ${maskProxy(raw)} → IP ${r.ip} (${r.ms}ms)`); }
    else { n.dead++; log(`[${sel.name}] ❌ ${maskProxy(raw)} → ${r.error}`); }
  })));

  const message = `${n.ok} sống, ${n.dead} chết, ${n.none} chưa có proxy`;
  log(`\n🏁 ${message}`);
  return { success: true, ...n, message };
}

// Đồng bộ proxy từ cột Sheet sang profile GPM. Mỗi kênh một proxy riêng: nếu hai kênh được chọn
// có cùng proxy thì kênh sau bị từ chối (dùng chung một IP cho nhiều kênh là điều cần tránh).
// Ô proxy trống thì GIỮ NGUYÊN proxy hiện có của profile (không xoá).
export async function runProxySync({ gpmHost, profiles, onLog, updateFn = updateGpmProfileProxy, listFn = listGpmProfilesFull }) {
  const log = onLog || console.log;
  if (!profiles?.length) throw new Error("Chưa chọn kênh nào");
  const current = new Map((await listFn(gpmHost)).map((p) => [p.id, p]));
  const res = { total: profiles.length, ok: 0, same: 0, fail: 0, skipped: 0 };
  const owner = new Map(); // proxy chuẩn hoá -> tên kênh đã dùng

  for (const p of profiles) {
    checkCancelled();
    const tag = `[${p.name}]`;
    if (!String(p.proxy ?? "").trim()) { res.skipped++; log(`${tag} ⏭ ô proxy trong Sheet trống — giữ nguyên proxy của profile`); continue; }
    let want;
    try { want = toGpmProxy(p.proxy); } catch (e) { res.fail++; log(`${tag} ❌ ${e.message}`); continue; }
    if (owner.has(want)) { res.fail++; log(`${tag} ❌ trùng proxy với kênh "${owner.get(want)}" — mỗi kênh cần một proxy riêng`); continue; }
    owner.set(want, p.name);

    let have = "";
    try { have = toGpmProxy(current.get(p.id)?.rawProxy); } catch { have = String(current.get(p.id)?.rawProxy ?? ""); }
    if (have === want) { res.same++; log(`${tag} ✅ đã đúng (${maskProxy(want)})`); continue; }
    try {
      await updateFn(gpmHost, p.id, want);
      res.ok++;
      log(`${tag} ✅ đã gán ${maskProxy(want)}`);
    } catch (e) {
      res.fail++;
      log(`${tag} ❌ ${e.message}`);
    }
  }
  const message = `gán mới ${res.ok}, đã đúng ${res.same}, bỏ qua ${res.skipped}, lỗi ${res.fail}`;
  log(`\n🏁 ${message}`);
  return { success: true, ...res, message };
}
