// Xoay vòng nhiều account Google Flow (Veo3) khi vẽ thumbnail, để một tài khoản không bị chạm giới hạn một mình.
//  - Ưu tiên account đã đăng nhập; chia đều lượt vẽ (round-robin).
//  - Mỗi account chỉ vẽ MỘT ảnh tại một thời điểm (hàng đợi riêng), tránh dồn dập làm Google nghi ngờ.
//  - Account hết hạn mức / bị yêu cầu xác minh / chưa đăng nhập thì "nghỉ" một lúc rồi mới được dùng lại; thử account kế tiếp ngay.
// Hàm thuần + bơm phụ thuộc (đồng hồ, danh sách account, hàm vẽ) để test không cần Chrome/Flow thật.

export const COOLDOWN = Object.freeze({ quota: 60 * 60_000, login: 6 * 60 * 60_000, verify: 30 * 60_000, other: 5 * 60_000 });

/** Phân loại lỗi vẽ ảnh của Flow thành quota | login | verify | other. */
export function classifyDrawError({ step, errorCode, message } = {}) {
  const m = String(message || "").toLowerCase();
  if (step === "need_login" || /chưa đăng nhập|hết hạn.*đăng nhập|login/.test(m)) return "login";
  if (errorCode === "quota" || /quota|hết (lượt|hạn mức)|giới hạn|vượt/.test(m)) return "quota";
  if (/bất thường|xác minh|unusual/.test(m)) return "verify";
  return "other";
}

export function createThumbAccountPool({ listAccounts, now = Date.now } = {}) {
  const until = new Map();   // id -> thời điểm được dùng lại
  const tails = new Map();   // id -> Promise cuối hàng đợi
  let rr = 0;

  const ready = (a) => (until.get(a.id) || 0) <= now();

  /** Thứ tự thử cho một lượt vẽ: account đã đăng nhập trước (xoay vòng), rồi tới account chưa rõ trạng thái. Bỏ account đang nghỉ/đã đăng xuất. */
  function order() {
    const all = (typeof listAccounts === "function" ? listAccounts() : []) || [];
    const good = all.filter((a) => a.lastLoginStatus === "logged_in" && ready(a));
    const unknown = all.filter((a) => a.lastLoginStatus !== "logged_in" && a.lastLoginStatus !== "logged_out" && ready(a));
    const start = good.length ? rr++ % good.length : 0;
    return [...good.slice(start), ...good.slice(0, start), ...unknown];
  }

  const cool = (id, kind) => until.set(id, now() + (COOLDOWN[kind] ?? COOLDOWN.other));

  /** Chạy fn(account) nối đuôi hàng đợi của account đó. */
  function withAccount(id, fn) {
    const prev = tails.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    tails.set(id, run.catch(() => {}));
    return run;
  }

  return { order, cool, withAccount, status: () => (listAccounts() || []).map((a) => ({ id: a.id, name: a.name, loginStatus: a.lastLoginStatus, restUntil: until.get(a.id) || 0 })) };
}

/**
 * Vẽ bằng lần lượt các account cho tới khi có ảnh.
 * @param {object} o
 * @param {ReturnType<typeof createThumbAccountPool>} o.pool
 * @param {(account) => Promise<{ok:boolean, kind?:string, message?:string}>} o.draw  trả { ok:true } khi vẽ xong
 * @returns {Promise<{ ok:boolean, accountId?:string, tried: {id:string, kind:string, message:string}[] }>}
 */
export async function drawWithAccounts({ pool, draw, log = () => {} }) {
  const tried = [];
  for (const acc of pool.order()) {
    let r;
    try { r = await pool.withAccount(acc.id, () => draw(acc)); }
    catch (e) { r = { ok: false, kind: "other", message: String(e?.message || e) }; }
    if (r && r.ok) return { ok: true, accountId: acc.id, tried };
    const kind = (r && r.kind) || "other", message = String((r && r.message) || "không rõ").slice(0, 160);
    pool.cool(acc.id, kind);
    tried.push({ id: acc.id, kind, message });
    log(`account "${acc.name || acc.id.slice(0, 8)}" không vẽ được (${kind}): ${message} → thử account khác.`);
  }
  return { ok: false, tried };
}
