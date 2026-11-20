/* Tab "Thống kê kênh": theo dõi các kênh của MÁY NÀY, gói trong MỘT màn hình.
 *   Hàng chỉ số: hôm nay, tỉ lệ upload, lỗi, proxy sắp hết hạn, view, sub
 *   Ba biểu đồ: proxy sắp hết hạn | tỉ lệ upload từng kênh | video đăng theo ngày
 *   Bảng chi tiết: mọi kênh trên một dòng (hạn proxy, 14 ngày, upload OK/lỗi, view, sub), tự cuộn bên trong khi nhiều kênh
 * Dữ liệu: /api/app/channel-stats (web) + số view/sub YouTube lưu trên máy. Biểu đồ vẽ bằng SVG thuần, không thêm thư viện.
 * Mọi chuỗi từ server đi qua esc() trước khi vào HTML. Dùng như script thường: window.ChannelDashboard.mount(root). */
(function () {
  "use strict";
  const C = { ok: "#51cf66", warn: "#fcc419", err: "#ff6b6b", off: "#64748b", brand: "#fa6e03", blue: "#4dabf7", grid: "rgba(148,163,184,.14)" };
  const fmt = (v) => Number(v || 0).toLocaleString("vi-VN");
  const short = (v) => { const n = Math.abs(v); if (n >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B"; if (n >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1e4) return Math.round(v / 1e3) + "K"; if (n >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K"; return String(Math.round(v)); };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const has = (v) => v !== null && v !== undefined;
  const sumOf = (a) => (a || []).reduce((s, x) => s + (x || 0), 0);
  function niceMax(v) { if (v <= 0) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  // Tính "lịch tới ngày nào" từ scheduledUntil ISO -> {text, cls, daysLeft}
  function schedLevel(iso) {
    if (!iso) return { key: "none", rank: 9, label: "Chưa lên lịch", color: C.off, daysLeft: null };
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return { key: "none", rank: 9, label: "Chưa lên lịch", color: C.off, daysLeft: null };
    const d = new Date(t);
    const daysLeft = (t - Date.now()) / 86400000;
    const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    if (daysLeft <= 0) return { key: "expired", rank: 0, label: `${label} (hết)`, color: C.err, daysLeft };
    if (daysLeft <= 1) return { key: "soon", rank: 1, label: `${label} (< 1 ngày)`, color: C.err, daysLeft };
    if (daysLeft <= 3) return { key: "week", rank: 2, label: `${label} (${Math.round(daysLeft)} ngày)`, color: C.warn, daysLeft };
    return { key: "ok", rank: 3, label: `${label} (${Math.round(daysLeft)} ngày)`, color: C.ok, daysLeft };
  }

  // ---------------------------------------------------------------- logic thuần (có test)
  /** Tỉ lệ upload thành công = ok / (ok + lỗi). null khi chưa có upload nào (không bịa 0% hay 100%). */
  function successRate(ok, err) { const t = (ok || 0) + (err || 0); return t ? Math.round(((ok || 0) / t) * 100) : null; }
  /** Mức khẩn của hạn proxy: expired < soon (<=3 ngày) < week (<=7) < ok < unknown < none. */
  function proxyLevel(c) {
    if (!c.proxy) return { key: "none", rank: 9, label: "Không dùng proxy", color: C.off };
    const d = c.proxyDaysLeft;
    if (!has(d)) return { key: "unknown", rank: 8, label: c.proxyState === "searching" ? "Đang tra hạn…" : "Chưa rõ hạn", color: C.off };
    if (d <= 0) return { key: "expired", rank: 0, label: "Đã hết hạn", color: C.err };
    if (d <= 3) return { key: "soon", rank: 1, label: `Còn ${d} ngày`, color: C.err };
    if (d <= 7) return { key: "week", rank: 2, label: `Còn ${d} ngày`, color: C.warn };
    return { key: "ok", rank: 3, label: `Còn ${d} ngày`, color: C.ok };
  }
  /** Kênh theo độ khẩn proxy: hết hạn/sắp hết hạn trước, rồi số ngày còn lại tăng dần. */
  function proxyOrder(chans) {
    return chans.map((c) => ({ c, p: proxyLevel(c) })).sort((a, b) => a.p.rank - b.p.rank || (a.c.proxyDaysLeft ?? 1e9) - (b.c.proxyDaysLeft ?? 1e9) || a.c.name.localeCompare(b.c.name));
  }
  /** Tình trạng tổng của kênh (chấm màu + lý do). */
  function statusOf(c) {
    const reasons = [], vs = c.videoStats || {};
    if (!c.enabled) return { key: "off", label: "Đang tắt", color: C.off, reasons };
    const pl = proxyLevel(c);
    if (vs.errors) reasons.push(`${vs.errors} video lỗi`);
    if (pl.key === "expired") reasons.push("proxy hết hạn");
    if (reasons.length) return { key: "error", label: "Có lỗi", color: C.err, reasons };
    if (c.uploadEnabled && !c.hasProfile) reasons.push("chưa có GPM profile");
    if (pl.key === "soon" || pl.key === "week") reasons.push(`proxy ${pl.label.toLowerCase()}`);
    if (c.warnings) reasons.push(`${c.warnings} cảnh báo cấu hình`);
    if (reasons.length) return { key: "warn", label: "Cần chú ý", color: C.warn, reasons };
    return { key: "ok", label: "Ổn", color: C.ok, reasons };
  }

  // ---------------------------------------------------------------- biểu đồ SVG
  function donut(parts, { size = 112, center = "", sub = "" } = {}) {
    const total = parts.reduce((s, p) => s + p.value, 0);
    const R = size / 2 - 10, cx = size / 2, cy = size / 2, sw = 12, L = 2 * Math.PI * R;
    let acc = 0;
    const segs = total ? parts.filter((p) => p.value > 0).map((p) => {
      const len = (p.value / total) * L, dash = Math.max(0, len - 2);
      const g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${p.color}" stroke-width="${sw}" stroke-dasharray="${dash} ${L - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(p.label)}: ${fmt(p.value)}</title></circle>`;
      acc += len; return g;
    }).join("") : "";
    return `<svg class="cd-donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(center)} ${esc(sub)}">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(148,163,184,.12)" stroke-width="${sw}"/>${segs}
      <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="cd-big">${esc(center)}</text>
      <text x="${cx}" y="${cy + 17}" text-anchor="middle" class="cd-dsub">${esc(sub)}</text></svg>`;
  }

  /** Cột chồng theo ngày: upload thành công (xanh) + lỗi (đỏ). */
  function dailyBars(days, ok, err, { width = 640, height = 210 } = {}) {
    const W = width, H = height, pl = 30, pr = 6, pt = 8, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
    const totals = days.map((_, i) => (ok[i] || 0) + (err[i] || 0));
    const max = niceMax(Math.max(...totals, 0)), step = iw / days.length, bw = Math.min(30, step * 0.66);
    const grid = [0, 0.5, 1].map((f) => { const t = Math.round(max * f), y = pt + ih - (t / max) * ih; return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${C.grid}"/><text x="${pl - 5}" y="${y + 3}" text-anchor="end" class="cd-ax">${t}</text>`; }).join("");
    const every = days.length > 16 ? 3 : days.length > 9 ? 2 : 1;
    const bars = days.map((day, i) => {
      const x = pl + i * step + (step - bw) / 2; let y = pt + ih;
      const seg = (v, color) => { const h = (v / max) * ih; if (h <= 0) return ""; y -= h; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" rx="2"/>`; };
      const tip = `${dm(day)}: ${fmt(ok[i] || 0)} đăng thành công` + (err[i] ? ` · ${fmt(err[i])} lỗi` : "");
      const lab = i % every === 0 || i === days.length - 1 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="cd-ax">${dm(day)}</text>` : "";
      return `<g><title>${esc(tip)}</title><rect x="${(pl + i * step).toFixed(1)}" y="${pt}" width="${step.toFixed(1)}" height="${ih}" fill="transparent"/>${seg(ok[i] || 0, C.ok)}${seg(err[i] || 0, C.err)}${lab}</g>`;
    }).join("");
    const empty = totals.every((t) => t === 0) ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="cd-ax">Chưa có video nào được đăng trong khoảng này</text>` : "";
    return `<svg class="cd-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Video đăng theo ngày">${grid}${bars}${empty}</svg>`;
  }

  /** Biểu đồ cột nhỏ trong một dòng của bảng: xu hướng đăng của riêng kênh (xanh = thành công, đỏ = lỗi). */
  function sparkBars(days, ok, err, { w = 96, h = 24 } = {}) {
    const n = days.length, totals = days.map((_, i) => (ok[i] || 0) + (err[i] || 0)), max = Math.max(...totals, 1);
    const step = w / n, bw = Math.max(1.5, step - 1.5);
    const bars = days.map((day, i) => {
      const x = i * step + (step - bw) / 2; let y = h;
      const seg = (v, color) => { const hh = (v / max) * (h - 2); if (hh <= 0) return ""; y -= hh; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${color}" rx="1"/>`; };
      return `<g><title>${esc(`${dm(day)}: ${fmt(ok[i] || 0)} thành công${err[i] ? " · " + fmt(err[i]) + " lỗi" : ""}`)}</title><rect x="${(i * step).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}" fill="transparent"/>${seg(ok[i] || 0, C.ok)}${seg(err[i] || 0, C.err)}</g>`;
    }).join("");
    const base = totals.every((t) => t === 0) ? `<line x1="0" x2="${w}" y1="${h - 1}" y2="${h - 1}" stroke="${C.grid}" stroke-dasharray="2 3"/>` : "";
    return `<svg class="cd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Xu hướng ${n} ngày">${base}${bars}</svg>`;
  }

  /** Thanh ngang. rows: [{label, sub, value, text, color}] */
  function hbars(rows, { max } = {}) {
    const m = max ?? Math.max(...rows.map((r) => r.value), 1);
    return `<div class="cd-hbars">${rows.map((r) => `<div class="cd-hbar"><div class="cd-hb-top"><span class="cd-hb-l" title="${esc(r.label)}">${esc(r.label)}</span><span class="cd-hb-v">${esc(r.text ?? fmt(r.value))}</span></div>
      <div class="cd-hb-track"><i style="width:${Math.max(r.value > 0 ? 2 : 0, Math.min(100, (r.value / m) * 100))}%;background:${r.color}"></i></div>${r.sub ? `<div class="cd-hb-s">${esc(r.sub)}</div>` : ""}</div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- màn hình
  function mount(root) {
    const st = { days: 14, data: null, err: null, loading: false, pick: "all", sort: "name", yt: false, compact: false };
    try { st.compact = localStorage.getItem("cd_compact") === "1"; } catch { /* không quan trọng */ }
    try { const d = Number(sessionStorage.getItem("cd_days")); if ([7, 14, 30].includes(d)) st.days = d; } catch { /* không quan trọng */ }
    root.classList.add("cd");

    function render() {
      root.classList.toggle("cd-compact", st.compact);
      const n = st.data?.channels?.length;
      const head = `<div class="cd-head"><div class="cd-title">Thống kê kênh<span>${n ? ` · ${n} kênh` : ""} · máy này</span></div>
        <div class="cd-head-r">${st.data?.offline ? `<span class="cd-chip warn">Mất kết nối, đang xem bản đã lưu</span>` : ""}
          <div class="cd-seg">${[7, 14, 30].map((d) => `<button type="button" data-days="${d}" class="${st.days === d ? "active" : ""}">${d} ngày</button>`).join("")}</div>
          <button type="button" class="btn btn-secondary cd-btn" id="cd-compact" title="Ẩn các biểu đồ để bảng chi tiết hiện được nhiều kênh nhất">${st.compact ? "▦ Hiện biểu đồ" : "▤ Chỉ xem bảng"}</button>
          <button type="button" class="btn btn-secondary cd-btn" id="cd-yt" title="Lấy lại lượt xem và sub từ YouTube (tốn một ít quota API)" ${st.yt ? "disabled" : ""}>${st.yt ? "⏳ Đang cập nhật…" : "▶ Cập nhật view/sub"}</button>
          <button type="button" class="btn btn-secondary cd-btn" id="cd-refresh" title="Nạp lại từ web">⟳ Làm mới</button></div></div>`;
      if (st.err && !st.data) { root.innerHTML = `${head}<div class="cd-empty"><strong>Chưa tải được thống kê</strong>${esc(st.err)}</div>`; return; }
      if (!st.data) { root.innerHTML = `${head}<div class="cd-skel">${'<div class="cd-card"></div>'.repeat(3)}</div>`; return; }
      const d = st.data, chans = d.channels;
      if (!chans.length) { root.innerHTML = `${head}<div class="cd-empty"><strong>Chưa có kênh nào được gán cho máy này</strong>Vào trang web để thêm kênh và gán máy.</div>`; return; }

      const T = d.days.length - 1;
      const rw = root.clientWidth || 1200, stacked = window.matchMedia("(max-width: 1100px)").matches;
      const colW = stacked ? Math.max(320, rw - 30) : Math.max(280, Math.floor((rw - 24) / 3) - 28);

      // ---- số liệu tổng
      const on = chans.filter((c) => c.enabled);
      // Đã đăng: mọi kênh (video đã lên thì đã lên, kể cả kênh vừa bị tắt). Chỉ tiêu: chỉ kênh đang bật.
      const todayDone = sumOf(chans.map((c) => c.uploadOk[T])), todayTarget = sumOf(on.map((c) => c.perDay));
      const okAll = sumOf(chans.map((c) => sumOf(c.uploadOk))), errAll = sumOf(chans.map((c) => sumOf(c.uploadErr)));
      const rate = successRate(okAll, errAll);
      const px = proxyOrder(chans);
      const pxBad = px.filter((x) => x.p.key === "expired" || x.p.key === "soon").length, pxWeek = px.filter((x) => x.p.key === "week").length;
      const errVideos = sumOf(chans.map((c) => c.videoStats?.errors));
      const ytRows = chans.filter((c) => c.yt && has(c.yt.views));
      const ytViews = sumOf(ytRows.map((c) => c.yt.views)), ytSubs = sumOf(ytRows.filter((c) => has(c.yt.subscribers)).map((c) => c.yt.subscribers));
      const ytAt = ytRows.map((c) => c.yt.updatedAt).filter(Boolean).sort().pop();
      const pct = todayTarget ? Math.min(100, Math.round((todayDone / todayTarget) * 100)) : 0;

      const kpi = (l, v, s, cls = "") => `<div class="cd-kpi ${cls}"><div class="cd-kpi-l">${l}</div><div class="cd-kpi-v">${v}</div><div class="cd-kpi-s">${s}</div></div>`;
      const noYt = "bấm “Cập nhật view/sub”";
      const kpis = `<div class="cd-kpis">
        ${kpi("Video hôm nay", `${fmt(todayDone)}<span>/${fmt(todayTarget)}</span>`, `<div class="cd-prog"><i style="width:${pct}%"></i></div>`)}
        ${kpi("Upload thành công", rate === null ? "—" : `${rate}%`, rate === null ? "chưa có dữ liệu" : `${fmt(okAll)} OK · ${fmt(errAll)} lỗi`, rate !== null && rate < 80 ? "bad" : "")}
        ${kpi("Video lỗi", fmt(errVideos), errVideos ? "cần xử lý" : "không có lỗi", errVideos ? "bad" : "")}
        ${kpi("Proxy sắp hết hạn", fmt(pxBad), pxBad ? "hết hạn hoặc ≤ 3 ngày" : pxWeek ? `${pxWeek} kênh còn ≤ 7 ngày` : "chưa có kênh nào sắp hết", pxBad ? "bad" : "")}
        ${kpi("Tổng lượt xem", ytRows.length ? short(ytViews) : "—", ytRows.length ? `${ytRows.length}/${chans.length} kênh${ytAt ? " · " + esc(ytAt) : ""}` : noYt)}
        ${kpi("Tổng sub", ytRows.length ? short(ytSubs) : "—", ytRows.length ? "cộng các kênh có số sub" : noYt)}
      </div>`;

      // ---- 1. proxy (cuộn trong thẻ nếu nhiều kênh)
      const pxRows = px.filter((x) => x.p.key !== "none");
      const pxMax = Math.max(30, ...pxRows.map((x) => (has(x.c.proxyDaysLeft) ? x.c.proxyDaysLeft : 0)));
      const pxBlock = pxRows.length ? hbars(pxRows.map((x) => ({
        label: x.c.name, sub: [x.c.proxyProvider, x.c.proxyExpiresAt ? "hết hạn " + new Date(x.c.proxyExpiresAt).toLocaleDateString("vi-VN") : ""].filter(Boolean).join(" · "),
        value: has(x.c.proxyDaysLeft) ? Math.max(0, x.c.proxyDaysLeft) : 0, text: x.p.label, color: x.p.color,
      })), { max: pxMax }) : `<div class="cd-none">Chưa có kênh nào dùng proxy</div>`;

      // ---- 2. tỉ lệ upload (donut cả máy + từng kênh, thấp nhất trước)
      const rated = chans.map((c) => ({ c, ok: sumOf(c.uploadOk), err: sumOf(c.uploadErr) })).filter((x) => x.ok + x.err > 0).sort((a, b) => (successRate(a.ok, a.err) - successRate(b.ok, b.err)) || b.err - a.err);
      const rateBlock = rated.length ? hbars(rated.map((x) => { const r = successRate(x.ok, x.err); return { label: x.c.name, sub: `${fmt(x.ok)} thành công · ${fmt(x.err)} lỗi`, value: r, text: r + "%", color: r >= 90 ? C.ok : r >= 70 ? C.warn : C.err }; }), { max: 100 })
        : `<div class="cd-none">Chưa có video nào được upload trong ${d.days.length} ngày</div>`;
      const donutBlock = donut([{ label: "Thành công", value: okAll, color: C.ok }, { label: "Lỗi", value: errAll, color: C.err }], { center: rate === null ? "—" : rate + "%", sub: "thành công" });

      // ---- 3. video theo ngày (cả máy hoặc một kênh)
      const sel = st.pick === "all" ? chans : chans.filter((c) => String(c.id) === st.pick);
      const dOk = d.days.map((_, i) => sumOf(sel.map((c) => c.uploadOk[i]))), dErr = d.days.map((_, i) => sumOf(sel.map((c) => c.uploadErr[i])));
      const picked = st.pick === "all" ? null : chans.find((c) => String(c.id) === st.pick);
      const dTotal = sumOf(dOk), dAvg = (dTotal / d.days.length).toFixed(1);

      // ---- bảng chi tiết
      const maxViews = Math.max(1, ...ytRows.map((c) => c.yt.views)), maxSubs = Math.max(1, ...ytRows.map((c) => (has(c.yt.subscribers) ? c.yt.subscribers : 0)));
      const sorters = {
        name: (a, b) => a.c.name.localeCompare(b.c.name),
        proxy: (a, b) => a.p.rank - b.p.rank || (a.c.proxyDaysLeft ?? 1e9) - (b.c.proxyDaysLeft ?? 1e9),
        sched: (a, b) => a.sc.rank - b.sc.rank || (a.sc.daysLeft ?? 1e9) - (b.sc.daysLeft ?? 1e9),
        rate: (a, b) => (successRate(a.ok, a.err) ?? 101) - (successRate(b.ok, b.err) ?? 101),
        views: (a, b) => (b.c.yt?.views ?? -1) - (a.c.yt?.views ?? -1),
        subs: (a, b) => (b.c.yt?.subscribers ?? -1) - (a.c.yt?.subscribers ?? -1),
      };
      const table = chans.map((c) => ({ c, s: statusOf(c), p: proxyLevel(c), sc: schedLevel(c.scheduledUntil), ok: sumOf(c.uploadOk), err: sumOf(c.uploadErr) })).sort(sorters[st.sort] || sorters.name);
      const th = (k, l, cls = "") => `<th class="${cls}"><button type="button" class="cd-th ${st.sort === k ? "on" : ""}" data-sort="${k}">${l}${st.sort === k ? " ↓" : ""}</button></th>`;
      const rows = table.map(({ c, s, p, sc, ok, err }) => {
        const r = successRate(ok, err), today = c.uploadOk[T] || 0, v = c.yt && has(c.yt.views) ? c.yt.views : null, sb = c.yt && has(c.yt.subscribers) ? c.yt.subscribers : null;
        return `<tr data-id="${c.id}" class="${st.pick === String(c.id) ? "sel" : ""}" tabindex="0" title="Bấm để xem riêng kênh này trên biểu đồ">
          <td><span class="cd-dot" style="background:${s.color}" title="${esc(s.label)}"></span></td>
          <td><div class="cd-n">${esc(c.name)}</div>${s.reasons.length ? `<div class="cd-s">${esc(s.reasons.join(" · "))}</div>` : ""}</td>
          <td><span class="cd-chip" style="--c:${p.color}">${esc(p.label)}</span></td>
          <td><span class="cd-chip" style="--c:${sc.color}">${esc(sc.label)}</span></td>
          <td class="num">${fmt(today)}<span class="muted">/${fmt(c.perDay)}</span></td>
          <td>${sparkBars(d.days, c.uploadOk, c.uploadErr)}</td>
          <td class="num">${r === null ? '<span class="muted">—</span>' : `<span style="color:${r >= 90 ? C.ok : r >= 70 ? C.warn : C.err}">${r}%</span><span class="muted"> ${fmt(ok)}/${fmt(err)}</span>`}</td>
          <td class="num ${c.videoStats?.waiting ? "" : "muted"}">${fmt(c.videoStats?.waiting || 0)}</td>
          <td class="num ${c.enabled && c.videoStats?.total && !c.videoStats?.fresh ? "bad" : c.videoStats?.fresh ? "" : "muted"}" title="${c.enabled && c.videoStats?.total && !c.videoStats?.fresh ? "Hết video chưa xử lý" : ""}">${fmt(c.videoStats?.fresh || 0)}</td>
          <td class="num ${c.videoStats?.errors ? "bad" : "muted"}">${fmt(c.videoStats?.errors || 0)}</td>
          <td class="num db" style="--w:${v === null ? 0 : Math.round((v / maxViews) * 100)}%;--c:rgba(77,171,247,.28)">${v === null ? '<span class="muted">—</span>' : fmt(v)}</td>
          <td class="num db" style="--w:${sb === null ? 0 : Math.round((sb / maxSubs) * 100)}%;--c:rgba(250,110,3,.28)">${sb === null ? '<span class="muted">—</span>' : fmt(sb)}</td></tr>`;
      }).join("");

      root.innerHTML = `${head}${kpis}
        <div class="cd-row3">
          <section class="cd-card"><div class="cd-t">Proxy sắp hết hạn<span class="cd-sub">cần gia hạn trước ở trên</span></div><div class="cd-body">${pxBlock}</div></section>
          <section class="cd-card"><div class="cd-t">Tỉ lệ upload<span class="cd-sub">${d.days.length} ngày · thấp nhất trước</span></div>
            <div class="cd-body cd-rate">${donutBlock}<div class="cd-rate-l">${rateBlock}</div></div></section>
          <section class="cd-card"><div class="cd-t">Video đăng theo ngày<span class="cd-sub">${esc(picked ? picked.name : "tất cả kênh")} · TB ${dAvg}/ngày</span>${picked ? `<button type="button" class="cd-link" data-clear>Xem tất cả</button>` : ""}</div>
            <div class="cd-body cd-chart">${dailyBars(d.days, dOk, dErr, { width: colW, height: 165 })}</div>
            <div class="cd-legend2"><span><i style="background:${C.ok}"></i>Thành công</span><span><i style="background:${C.err}"></i>Lỗi</span></div></section>
        </div>
        <section class="cd-card cd-tcard"><div class="cd-t">Chi tiết từng kênh<span class="cd-sub">bấm tiêu đề cột để sắp xếp · bấm dòng để xem riêng trên biểu đồ</span></div>
          <div class="cd-tw"><table class="cd-table"><thead><tr><th></th>${th("name", "Kênh")}${th("proxy", "Hạn proxy")}${th("sched", "Lịch tới")}<th class="r">Hôm nay</th><th>${d.days.length} ngày</th>${th("rate", "Upload OK/Lỗi", "r")}<th class="r" title="Đã render, chưa lên lịch">Chờ đăng</th><th class="r" title="Video chưa được xử lý">Còn</th><th class="r">Video lỗi</th>${th("views", "View", "r")}${th("subs", "Sub", "r")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    async function load(manual) {
      if (st.loading) return;
      st.loading = true;
      try {
        const r = await window.electronAPI.sheet.channelStats(st.days);
        if (!r || !r.ok) throw new Error((r && r.error) || "Không tải được");
        st.data = r; st.err = null; render();
        if (manual && typeof appToast === "function") appToast("Đã làm mới thống kê", { kind: "success" });
      } catch (e) { st.err = e?.message || String(e); if (!st.data) render(); if (manual && typeof appToast === "function") appToast(st.err, { kind: "error" }); }
      finally { st.loading = false; }
    }
    async function refreshYt() {
      if (st.yt) return; st.yt = true; render();
      try {
        const r = await window.electronAPI.sheet.refreshStats();
        if (!r || !r.ok) throw new Error((r && r.error) || "Không cập nhật được");
        const bad = (r.rows || []).filter((x) => x.error).length;
        if (typeof appToast === "function") appToast(bad ? `Đã cập nhật, ${bad} kênh lỗi (kiểm tra Link kênh)` : "Đã cập nhật view/sub", { kind: bad ? "error" : "success" });
      } catch (e) { if (typeof appToast === "function") appToast(e?.message || "Không cập nhật được", { kind: "error" }); }
      finally { st.yt = false; await load(); }
    }

    root.addEventListener("click", (e) => {
      const dd = e.target.closest("[data-days]");
      if (dd) { st.days = Number(dd.dataset.days); try { sessionStorage.setItem("cd_days", st.days); } catch { /* ignore */ } st.data = null; render(); return load(); }
      if (e.target.closest("#cd-compact")) { st.compact = !st.compact; try { localStorage.setItem("cd_compact", st.compact ? "1" : "0"); } catch { /* ignore */ } return render(); }
      if (e.target.closest("#cd-refresh")) return load(true);
      if (e.target.closest("#cd-yt")) return refreshYt();
      if (e.target.closest("[data-clear]")) { st.pick = "all"; return render(); }
      const so = e.target.closest("[data-sort]");
      if (so) { st.sort = so.dataset.sort; return render(); }
      const tr = e.target.closest("tr[data-id]");
      if (tr) { st.pick = st.pick === tr.dataset.id ? "all" : tr.dataset.id; render(); }
    });
    root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-id]")) { e.preventDefault(); e.target.click(); } });

    let rz = null, lastW = 0;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (root.offsetParent !== null && st.data && Math.abs(root.clientWidth - lastW) > 8) { lastW = root.clientWidth; render(); } }, 150); });
    render(); load();
    const timer = setInterval(() => { if (!document.hidden && root.offsetParent !== null) load(); }, 60000);
    return { reload: () => { if (root.offsetParent !== null) load(); else st.data = null; }, destroy: () => clearInterval(timer) };
  }

  window.ChannelDashboard = { mount, successRate, proxyLevel, proxyOrder, statusOf, schedLevel, dailyBars, sparkBars };
})();
