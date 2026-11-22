/* Tạo / sửa / xóa cấu hình kênh Auto ngay trong app. Server giữ dữ liệu, web chỉ xem (app > server > web).
 *
 * - Form được dựng từ ĐỊNH NGHĨA TRƯỜNG do máy chủ gửi kèm, nên app không giữ bản sao danh sách trường (không bao giờ lệch với web).
 * - Chỉ làm việc với kênh của máy này. Tên kênh đặt lúc tạo, không đổi sau đó (tên là tên thư mục trên máy).
 * - Mất mạng: xem được bản đã lưu nhưng khóa nút Lưu. Hai nơi sửa cùng lúc: máy chủ trả 409, app nạp lại bản mới.
 * - Giao diện chỉ dùng textContent / value (không nội suy HTML) vì mọi chuỗi đều đến từ máy chủ.
 *
 * Dùng như script thường (nạp trước renderer.js): window.ChannelConfigUI.open(name) / .onChange(cb).
 */
(function () {
  "use strict";
  const api = () => window.electronAPI && window.electronAPI.sheet;
  const $ = (id) => document.getElementById(id);
  let st = { data: null, offline: false, byName: new Map(), loading: false };
  const listeners = new Set();

  // ---------------------------------------------------------------- dựng phần tử an toàn
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  // ---------------------------------------------------------------- tải dữ liệu
  async function load() {
    if (!api() || !api().channelsList) return { ok: false, error: "Phiên bản app không hỗ trợ" };
    st.loading = true;
    const r = await api().channelsList().catch((e) => ({ ok: false, error: e.message }));
    st.loading = false;
    if (r && r.ok) {
      st.data = r; st.offline = !!r.offline;
      st.byName = new Map(r.channels.map((c) => [c.name, c]));
    }
    return r;
  }

  // ---------------------------------------------------------------- giá trị <-> ô nhập
  function rawOf(c, schema) {
    const raw = {};
    for (const f of schema.fields) {
      let v = f.section === "core" ? c[f.key] : (c.params || {})[f.key];
      if (v === undefined || v === null) v = "";
      raw[f.key] = typeof v === "boolean" ? (v ? "1" : "0") : Array.isArray(v) ? v.join(", ") : String(v);
    }
    return raw;
  }
  function control(f, value, withDefault) {
    const id = `ccu-${f.key}`;
    const common = { id, "data-k": f.key };
    if (f.type === "bool") {
      const s = el("select", common);
      if (withDefault) s.append(el("option", { value: "", text: "(mặc định)" }));
      s.append(el("option", { value: "1", text: "Bật" }), el("option", { value: "0", text: "Tắt" }));
      s.value = value; return s;
    }
    if (f.type === "enum") {
      const s = el("select", common);
      if (withDefault) s.append(el("option", { value: "", text: "(mặc định)" }));
      for (const o of f.options) { const m = (st.data.schema.modes || []).find((x) => x.id === o); s.append(el("option", { value: o, text: m ? m.label : o })); }
      s.value = value; return s;
    }
    if (f.type === "source") {
      const s = el("select", common, el("option", { value: "download", text: "Tải về từ kênh nguồn" }), el("option", { value: "local", text: "Có sẵn trên máy" }));
      s.value = value === "local" ? "local" : "download"; return s;
    }
    const i = el("input", { ...common, type: "text", autocomplete: "off", spellcheck: "false", placeholder: f.placeholder || (f.min !== undefined ? `${f.min} – ${f.max}` : "") });
    i.value = value; return i;
  }
  const readAll = (root) => { const o = {}; root.querySelectorAll("[data-k]").forEach((e) => { o[e.dataset.k] = e.value; }); return o; };
  const typed = (schema, raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) { const f = schema.fields.find((x) => x.key === k); out[k] = f && f.type === "bool" ? (v === "1" ? true : v === "0" ? false : "") : v; }
    return out;
  };

  // ---------------------------------------------------------------- hộp thoại
  function ensureModal() {
    let m = $("ccu-modal");
    if (m) return m;
    m = el("div", { id: "ccu-modal", class: "modal ccu-host" });
    document.body.append(m);
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    return m;
  }
  function close() { const m = $("ccu-modal"); if (m) m.classList.remove("active"); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("ccu-modal")?.classList.contains("active")) close(); });

  function badge(text, cls) { return el("span", { class: `ccu-badge ${cls || ""}`, text }); }

  async function open(name) {
    const m = ensureModal();
    const spinner = el("div", { class: "ccu-card" }, el("div", { class: "ccu-head" }, el("h3", { text: name || "Kênh" }), el("button", { class: "modal-close", type: "button", onclick: close, "aria-label": "Đóng", text: "×" })), el("div", { class: "ccu-body", text: "Đang tải…" }));
    m.replaceChildren(spinner); m.classList.add("active");
    const r = await load();
    if (!r || !r.ok) {
      m.replaceChildren(el("div", { class: "ccu-card" }, head(name || "Kênh"), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: (r && r.error) || "Không tải được cấu hình kênh" }), el("p", { class: "ccu-muted", text: "Cần có mạng và đăng nhập lần đầu để xem cấu hình kênh." })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }))));
      return;
    }
    const c = st.byName.get(name);
    if (!c) {
      m.replaceChildren(el("div", { class: "ccu-card" }, head(name), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: `Không thấy kênh “${name}” trên web cho máy này.` }), el("p", { class: "ccu-muted", text: "Kênh có thể đã bị xóa hoặc chuyển sang máy khác. Hãy kiểm tra ở trang web." })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }))));
      return;
    }
    render(c);
  }
  function head(title, sub) {
    return el("div", { class: "ccu-head" }, el("div", {}, el("h3", { text: title }), sub ? el("div", { class: "ccu-sub", text: sub }) : null), el("button", { class: "modal-close", type: "button", onclick: close, "aria-label": "Đóng", text: "×" }));
  }

  // opts.host: vẽ thẳng vào phần tử này (khung chi tiết bên phải); không có thì dùng hộp thoại
  function render(c, opts = {}) {
    const inline = !!opts.host;
    const m = opts.host || ensureModal(), schema = st.data.schema;
    let raw = rawOf(c, schema);
    const mode = () => raw.renderMode || "topTransparent";
    const fieldByKey = (k) => schema.fields.find((f) => f.key === k);
    const group = (f, withDefault) => {
      const g = el("div", { class: "ccu-group" }, el("label", { for: `ccu-${f.key}`, text: f.label }));
      g.append(control(f, raw[f.key], withDefault));
      if (f.help) g.append(el("div", { class: "ccu-help", text: f.help }));
      return g;
    };

    const creating = !!opts.create;
    const body = el("div", { class: "ccu-body" });
    const form = el("form", { autocomplete: "off", novalidate: true });
    const foot = el("div", { class: "ccu-foot" });

    // đầu: tên + thống kê + cảnh báo
    const vs = c.videoStats || {};
    const sub = [c.proxy ? proxyLine(c) : "", `hôm nay ${vs.today || 0}/${vs.perDay || 0}`, vs.errors ? `${vs.errors} lỗi` : "", `đã đăng ${vs.posted || 0}/${vs.total || 0} video`].filter(Boolean).join(" · ");
    if (inline) m.replaceChildren(el("div", { class: "ccu-inline" }, body));
    else m.replaceChildren(el("div", { class: "ccu-card" }, head(c.name, sub), body));
    if (st.offline) body.append(el("div", { class: "ccu-note warn", text: "Đang mất kết nối tới máy chủ: chỉ xem được bản đã lưu, chưa sửa được. Có mạng lại hãy mở lại hộp này." }));
    if (c.warnings && c.warnings.length) {
      const ul = el("ul", {}, c.warnings.map((w) => el("li", {}, w.field && fieldByKey(w.field) ? el("b", { text: fieldByKey(w.field).label + ": " }) : null, w.message)));
      body.append(el("div", { class: "ccu-note warn" }, el("strong", { text: `Cần xử lý (${c.warnings.length})` }), ul));
    }
    body.append(form);

    const core = (k) => fieldByKey(k);
    const row = (...fs) => el("div", { class: "ccu-row" }, fs.map((f) => group(core(f), false)));
    let nameInput = null;
    if (creating) {
      nameInput = el("input", { id: "ccu-name", type: "text", autocomplete: "off", maxlength: "60", placeholder: "vd: LOFI_01 (cũng là tên thư mục trên máy)", value: c.name || "" });
      form.append(el("div", { class: "ccu-group" }, el("label", { for: "ccu-name", text: "Tên kênh *" }), nameInput, el("div", { class: "ccu-help", text: "Không đổi được sau khi tạo. Không chứa \\ / : * ? \" < > |" })));
    }
    form.append(
      row("enabled", "uploadEnabled"), row("videosPerDay", "videoSource"), group(core("sourceHandle"), false), group(core("postTimes"), false),
    );

    // GPM Profile: custom dropdown với tìm kiếm, hiện "Tên (Group)"
    const gpmGroup = el("div", { class: "ccu-group" });
    const gpmLabel = el("label", { for: "ccu-gpmProfileId-input", text: "GPM Profile" });
    const gpmHidden = el("input", { type: "hidden", id: "ccu-gpmProfileId", "data-k": "gpmProfileId", value: raw.gpmProfileId || "" });
    const gpmWrap = el("div", { class: "ccu-gpm-wrap" });
    const gpmInput = el("input", { type: "text", id: "ccu-gpmProfileId-input", class: "ccu-gpm-input", autocomplete: "off", placeholder: "Tìm hoặc chọn profile..." });
    const gpmClear = el("button", { type: "button", class: "ccu-gpm-clear", title: "Xóa", text: "×" });
    const gpmDropdown = el("div", { class: "ccu-gpm-dropdown" });
    gpmWrap.append(gpmInput, gpmClear, gpmDropdown);
    const gpmHelp = el("div", { class: "ccu-help", text: "Profile GPM để chạy kênh này. Gõ để tìm, click để chọn." });
    gpmGroup.append(gpmLabel, gpmHidden, gpmWrap, gpmHelp);
    form.append(el("div", { class: "ccu-row" }, gpmGroup, group(core("monetized"), false)));
    form.append(group(core("channelUrl"), false));

    // GPM Profile dropdown logic
    let gpmProfiles = [], gpmGroups = {}, gpmSelected = null;
    let proxyAutoFilled = null; // giá trị ô Proxy do app tự điền từ profile (khác giá trị người dùng tự gõ)
    const setGpmDisplay = (p) => {
      gpmSelected = p;
      if (p) {
        gpmHidden.value = p.id;
        gpmInput.value = `${p.name} (${gpmGroups[p.groupId] || "Chung"})`;
        gpmClear.style.display = "block";
      } else {
        gpmHidden.value = "";
        gpmInput.value = "";
        gpmClear.style.display = "none";
      }
    };
    const renderGpmDropdown = (filter = "") => {
      const q = filter.toLowerCase().trim();
      const filtered = gpmProfiles.filter(p => {
        const grp = gpmGroups[p.groupId] || "Chung";
        return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || grp.toLowerCase().includes(q);
      });
      gpmDropdown.innerHTML = "";
      if (!filtered.length) {
        gpmDropdown.append(el("div", { class: "ccu-gpm-empty", text: q ? "Không tìm thấy profile" : "Không có profile GPM" }));
        return;
      }
      // Group by group_id, sort groups alphabetically
      const byGroup = new Map();
      for (const p of filtered) {
        const gid = p.groupId || "__none";
        if (!byGroup.has(gid)) byGroup.set(gid, []);
        byGroup.get(gid).push(p);
      }
      const sortedGroups = [...byGroup.entries()].sort((a, b) => {
        const na = gpmGroups[a[0]] || "Chung", nb = gpmGroups[b[0]] || "Chung";
        return na.localeCompare(nb);
      });
      for (const [gid, ps] of sortedGroups) {
        const grpName = gpmGroups[gid] || "Chung";
        gpmDropdown.append(el("div", { class: "ccu-gpm-grp", text: grpName }));
        for (const p of ps) {
          const item = el("div", { class: "ccu-gpm-item" + (p.id === gpmHidden.value ? " active" : ""), "data-id": p.id });
          item.append(el("span", { class: "ccu-gpm-name", text: p.name }), el("span", { class: "ccu-gpm-id", text: p.id }));
          item.addEventListener("click", () => {
            setGpmDisplay(p);
            // Tự động điền địa chỉ proxy của profile (proxyMasked chỉ có scheme://host:port, không có user/mật khẩu).
            // Profile không dùng proxy thì để trống: kênh không có hạn proxy.
            proxyAutoFilled = p.hasProxy ? (p.proxyMasked || "") : "";
            proxyInput.value = proxyAutoFilled;
            proxyInput.dispatchEvent(new Event("input", { bubbles: true }));
            // Báo rõ kết quả: profile không có proxy thì ô để trống là đúng, không phải lỗi
            proxyHelpEl.textContent = p.hasProxy
              ? `Đã điền proxy của profile "${p.name}". Bấm Lưu để gửi địa chỉ lên web (user/mật khẩu ở lại trong GPM).`
              : `Profile "${p.name}" không dùng proxy trong GPM nên ô này để trống (kênh sẽ không có hạn proxy).`;
            gpmDropdown.classList.remove("open");
          });
          gpmDropdown.append(item);
        }
      }
    };
    // Focus: mở dropdown, nếu đã có giá trị thì xóa để tìm
    gpmInput.addEventListener("focus", () => {
      gpmDropdown.classList.add("open");
      if (gpmSelected) {
        gpmInput.value = "";  // Clear để tìm kiếm
        gpmInput.placeholder = `Đang chọn: ${gpmSelected.name}. Gõ để tìm...`;
      }
      renderGpmDropdown("");
    });
    gpmInput.addEventListener("input", () => renderGpmDropdown(gpmInput.value));
    gpmInput.addEventListener("blur", () => {
      setTimeout(() => {
        gpmDropdown.classList.remove("open");
        // Restore display nếu không chọn gì mới
        if (gpmSelected) {
          gpmInput.value = `${gpmSelected.name} (${gpmGroups[gpmSelected.groupId] || "Chung"})`;
          gpmInput.placeholder = "Tìm hoặc chọn profile...";
        }
      }, 180);
    });
    gpmInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { gpmDropdown.classList.remove("open"); gpmInput.blur(); } });
    gpmClear.addEventListener("click", (e) => { e.preventDefault(); setGpmDisplay(null); gpmInput.focus(); });
    gpmClear.style.display = raw.gpmProfileId ? "block" : "none";

    // Async load GPM profiles
    (async () => {
      try {
        const gpmApi = window.electronAPI?.sheet?.gpmListProfilesFull;
        if (!gpmApi) { gpmHelp.textContent = "Phiên bản app không hỗ trợ lấy danh sách GPM Profile."; return; }
        const r = await gpmApi();
        if (!r || !r.ok) { gpmHelp.textContent = "Không lấy được danh sách GPM Profile: " + (r?.error || "lỗi"); return; }
        gpmProfiles = r.profiles || [];
        gpmGroups = Object.fromEntries((r.groups || []).map(g => [g.id, g.name]));
        // Set display value
        const cur = gpmProfiles.find(p => p.id === raw.gpmProfileId);
        if (cur) {
          setGpmDisplay(cur);
        } else if (raw.gpmProfileId) {
          gpmInput.value = `${raw.gpmProfileId} (không tìm thấy)`;
          gpmClear.style.display = "block";
        }
        gpmHelp.textContent = `${gpmProfiles.length} profile GPM. Click vào ô để tìm và chọn.`;
        renderGpmDropdown();
      } catch (e) { gpmHelp.textContent = "Lỗi khi lấy danh sách GPM: " + e.message; }
    })();

    // Proxy: web chỉ giữ địa chỉ (để tra hạn). Chọn GPM Profile thì tự điền địa chỉ proxy của profile đó.
    // Muốn đổi proxy: nhập đủ ip:port:user:pass, app ghi vào GPM profile (user/mật khẩu không lên web).
    const pxHelp = "Tự điền khi chọn GPM Profile. Muốn đổi proxy: nhập ip:port:user:pass, app lưu vào GPM trên máy này, web chỉ nhận địa chỉ ip:port để tra hạn.";
    const proxyInput = el("input", { id: "ccu-proxy", "data-k": "proxy", type: "text", autocomplete: "off", spellcheck: "false", class: "ccu-mono", value: raw.proxy || "", placeholder: "Chọn GPM Profile để tự điền, hoặc ip:port:user:pass" });
    const proxyHelpEl = el("div", { class: "ccu-help", text: pxHelp });
    form.append(el("div", { class: "ccu-group" }, el("label", { for: "ccu-proxy", text: "Proxy tải" }), proxyInput, proxyHelpEl));
    if (c.proxy) {
      const st2 = c.proxyExpiryState || "unknown";
      if (c.proxyExpiresAt) form.append(el("div", { class: "ccu-auto" }, `Hết hạn ${new Date(c.proxyExpiresAt).toLocaleDateString("vi-VN")} · còn ${c.proxyDaysLeft} ngày${c.proxyExpiryProvider ? " · theo " + c.proxyExpiryProvider : ""}`));
      else form.append(el("div", { class: "ccu-expwait" }, st2 === "searching" ? "Đang hỏi lần lượt các nhà cung cấp proxy…" : st2 === "notfound" ? "Không nhà cung cấp nào đã kết nối có IP này." : "Chưa tra được hạn proxy."));
    }

    // cách render: đổi kiểu thì dựng lại phần thông số
    form.append(el("div", { class: "ccu-sep", text: "Cách render" }));
    const modeBox = el("div", { class: "ccu-modebox" });
    const AI_KEYS = new Set(["aiTitle", "aiTitleRule", "aiThumbRule", "aiThumbSamples"]);
    const drawMode = () => {
      const md = (schema.modes || []).find((x) => x.id === mode());
      const fs = schema.fields.filter((f) => f.section === "mode" && f.modes.includes(mode()) && !AI_KEYS.has(f.key));
      modeBox.replaceChildren(
        md ? el("div", { class: "ccu-help", text: md.help }) : null,
        mode() === "composer" ? group(core("presetName"), false) : null,
        fs.length ? el("div", { class: "ccu-grid" }, fs.map((f) => group(f, true))) : el("div", { class: "ccu-help", text: "Kiểu này không có thông số riêng." }),
      );
    };
    form.append(group(core("renderMode"), false), modeBox);
    drawMode();

    // ─── AI tối ưu title + thumbnail ────────────────────────────────────────────────────────────
    let saveAiKey = null; // gán khi form có ô khóa AI
    let getSamplesFn = null; // gán khi form có phần hình mẫu
    const aiField = schema.fields.find((f) => f.key === "aiTitle");
    if (aiField) {
      const aiSection = el("div", { class: "ccu-ai-section" });

      // Khóa AI của kênh: LUÔN hi��n (không phụ thuộc toggle bật/tắt AI)
      const aiApi = window.electronAPI && window.electronAPI.ai;
      if (aiApi && !creating) {
        const keyBox = el("div", { class: "ccu-group" }), keyMsg = el("div", { class: "ccu-help" });
        const keyIn = el("input", { type: "text", id: "ccu-aikey", autocomplete: "off", spellcheck: "false", placeholder: "Dán khóa Gemini API (lấy miễn phí ở Google AI Studio)" });
        let masked = "";
        const showMask = () => { keyIn.value = masked; keyIn.classList.toggle("ccu-masked", !!masked); };
        keyIn.addEventListener("focus", () => { if (masked && keyIn.value === masked) { keyIn.value = ""; keyIn.classList.remove("ccu-masked"); } });
        const paintKey = (v) => {
          masked = v && v.hasKey ? "••••••••" + String(v.keyHint || "").replace(/^…/, "") : "";
          showMask();
          keyMsg.textContent = masked ? "Đã lưu khóa trên máy này. Bấm vào ô để thay khóa mới, xóa trắng rồi lưu để gỡ khóa." : "Chưa có khóa: AI sẽ tự bỏ qua, video vẫn dùng title và thumbnail gốc.";
        };
        aiApi.keyGet(c.name).then(paintKey).catch(() => {});
        saveAiKey = async () => {
          const typedKey = keyIn.value.trim();
          if (typedKey === masked) return { ok: true };
          if (!typedKey) { await aiApi.keyClear(c.name); paintKey(await aiApi.keyGet(c.name)); return { ok: true }; }
          const r = await aiApi.keySet(c.name, typedKey).catch((er) => ({ ok: false, error: er.message }));
          if (r && r.ok) { paintKey(await aiApi.keyGet(c.name)); return { ok: true }; }
          return { ok: false, error: (r && r.error) || "Không lưu được khóa AI" };
        };
        keyBox.append(el("label", { for: "ccu-aikey", text: "🔑 Khóa Gemini API" }), keyIn, keyMsg);
        aiSection.append(el("div", { class: "ccu-sep", text: "AI tối ưu title + thumbnail" }), keyBox);
      } else {
        aiSection.append(el("div", { class: "ccu-sep", text: "AI tối ưu title + thumbnail" }));
      }

      // Toggle bật/tắt AI
      const aiToggleRow = el("div", { class: "ccu-ai-toggle-row" });
      aiToggleRow.append(group(aiField, true));
      aiSection.append(aiToggleRow);

      // Panel cấu hình AI (ẩn khi tắt) - chỉ có rule và hình mẫu
      const aiConfigPanel = el("div", { class: "ccu-ai-config", id: "ccu-ai-config" });

      // Rule viết title
      const titleRuleIn = el("textarea", { id: "ccu-aiTitleRule", "data-k": "aiTitleRule", rows: "3", spellcheck: "false", placeholder: "VD: Ngắn gọn, gây tò mò, dùng số nếu có (5 bí mật...), không dùng emoji" });
      titleRuleIn.value = raw.aiTitleRule || "";

      // Rule vẽ thumbnail
      const thumbRuleIn = el("textarea", { id: "ccu-aiThumbRule", "data-k": "aiThumbRule", rows: "3", spellcheck: "false", placeholder: "VD: Màu nổi bật, tương phản cao, có khuôn mặt thể hiện cảm xúc, text lớn dễ đọc trên mobile" });
      thumbRuleIn.value = raw.aiThumbRule || "";

      // Hình mẫu thumbnail
      const thumbSamples = el("div", { class: "ccu-thumb-samples" });
      // Lấy từ dữ liệu gốc của kênh (raw đã bị rawOf nối thành chuỗi nên không dùng được)
      let samples = Array.isArray((c.params || {}).aiThumbSamples) ? [...c.params.aiThumbSamples] : [];
      const MAX_SAMPLES = 3;

      const renderSamples = () => {
        thumbSamples.replaceChildren();
        for (let i = 0; i < samples.length; i++) {
          const wrap = el("div", { class: "ccu-thumb-item" });
          const img = el("img", { src: samples[i], alt: "Hình mẫu " + (i + 1) });
          const del = el("button", { type: "button", class: "ccu-thumb-del", text: "×", title: "Xóa hình này" });
          del.addEventListener("click", () => { samples.splice(i, 1); renderSamples(); });
          wrap.append(img, del);
          thumbSamples.append(wrap);
        }
        if (samples.length < MAX_SAMPLES) {
          const addBtn = el("label", { class: "ccu-thumb-add", title: "Thêm hình mẫu" });
          addBtn.append(el("span", { text: "+" }), el("input", { type: "file", accept: "image/*", hidden: true }));
          addBtn.querySelector("input").addEventListener("change", async (ev) => {
            const file = ev.target.files[0];
            if (!file) return;
            ev.target.value = "";
            if (!/^image\//.test(file.type)) { window.appToast && window.appToast("Chọn file ảnh (jpg, png, webp)", { kind: "error" }); return; }
            // Thu nhỏ về tối đa 480px rộng + JPEG 70%: mẫu chỉ để AI học phong cách, không cần ảnh gốc nặng.
            const reader = new FileReader();
            reader.onload = () => {
              const im = new Image();
              im.onload = () => {
                const k = Math.min(1, 480 / im.width), cv = document.createElement("canvas");
                cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
                cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
                const url = cv.toDataURL("image/jpeg", 0.7);
                if (samples.length < MAX_SAMPLES) { samples.push(url); renderSamples(); }
              };
              im.onerror = () => { window.appToast && window.appToast("Không đọc được ảnh này", { kind: "error" }); };
              im.src = reader.result;
            };
            reader.readAsDataURL(file);
          });
          thumbSamples.append(addBtn);
        }
      };
      renderSamples();

      // Getter để đọc samples khi submit
      const getSamples = () => samples;

      aiConfigPanel.append(
        el("div", { class: "ccu-group" }, el("label", { for: "ccu-aiTitleRule", text: "📝 Rule viết title" }), titleRuleIn, el("div", { class: "ccu-help", text: "Để trống = AI tự quyết định cách viết." })),
        el("div", { class: "ccu-group" }, el("label", { for: "ccu-aiThumbRule", text: "🖼️ Rule vẽ thumbnail" }), thumbRuleIn, el("div", { class: "ccu-help", text: "Để trống = AI tự quyết định phong cách." })),
        el("div", { class: "ccu-group" }, el("label", { text: "📸 Hình mẫu thumbnail (CTR tốt)" }), thumbSamples, el("div", { class: "ccu-help", text: "Tải lên tối đa 3 hình. AI sẽ vẽ thumbnail mới theo phong cách tương tự." })),
        el("div", { class: "ccu-help", text: "Thumbnail mới được vẽ bằng Google Flow. Cần đăng nhập Google Flow trong profile GPM của kênh một lần; chưa đăng nhập thì chỉ đổi title, thumbnail giữ nguyên." }),
      );

      // Hiện/ẩn panel theo toggle
      const updateAiPanel = () => {
        const chk = form.querySelector('[data-k="aiTitle"]');
        aiConfigPanel.style.display = chk && chk.value === "1" ? "block" : "none";
      };
      aiToggleRow.addEventListener("change", updateAiPanel);

      aiSection.append(aiConfigPanel);
      form.append(aiSection);
      setTimeout(updateAiPanel, 0);

      getSamplesFn = getSamples; // submit sẽ lấy hình mẫu từ đây (readAll chỉ đọc các ô có data-k)
    }
    form.append(el("div", { class: "ccu-note", text: creating ? "Kênh được tạo cho máy này. Một GPM Profile chỉ dùng cho một kênh hoặc một mẻ." : "Cấu hình kênh chỉ sửa trong app; web chỉ để theo dõi." }));

    const msg = el("div", { class: "ccu-msg", role: "alert", "aria-live": "polite" });
    const save = el("button", { class: "btn btn-primary", type: "button", id: "ccu-save", text: creating ? "Tạo kênh" : "Lưu thay đổi", onclick: () => form.requestSubmit() });
    const delBtn = !creating && !st.offline ? el("button", { class: "btn btn-secondary", type: "button", id: "ccu-delete", text: "Xóa kênh", onclick: async () => { const r = await removeChannel(c); if (r && !r.ok && !r.canceled) { msg.className = "ccu-msg err"; msg.textContent = r.error || "Không xóa được"; } } }) : null;
    if (st.offline) { save.disabled = true; save.title = "Mất kết nối tới máy chủ"; }
    foot.append(msg, ...(delBtn ? [delBtn] : []), el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }), save);
    m.firstChild.append(foot);
    const rerender = (nc) => render(nc, opts);

    form.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.k === "renderMode") { raw = { ...raw, ...readAll(form) }; drawMode(); const f = $("ccu-renderMode"); if (f) f.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (st.offline) return;
      raw = { ...raw, ...readAll(form) };
      const out = typed(schema, raw);
      if (getSamplesFn) out.aiThumbSamples = getSamplesFn(); // mảng ảnh (không đi qua ô chữ)
      // chỉ gửi tham số của kiểu đang chọn (tham số kiểu khác giữ nguyên trên máy chủ); các khóa không sửa được thì bỏ
      const keep = new Set([...schema.coreKeys, ...AI_KEYS, ...schema.fields.filter((f) => f.section === "mode" && f.modes.includes(mode())).map((f) => f.key)]);
      for (const k of Object.keys(out)) if (!keep.has(k)) delete out[k];
      delete out.name; if (mode() !== "composer") delete out.presetName;
      if (creating) out.name = (nameInput.value || "").trim();
      // Proxy: web chỉ nhận địa chỉ (scheme://host:port). Nếu người dùng gõ proxy đầy đủ có user/mật khẩu thì ghi vào
      // GPM profile trên máy này (main process), phần gửi lên web đã bị cắt user/mật khẩu.
      const typedProxy = String(out.proxy || "").trim();
      let gpmWrite = null;
      if (typedProxy === (c.proxy || "") || (proxyAutoFilled !== null && typedProxy === proxyAutoFilled)) delete out.proxy; // không đổi / app tự điền: không gửi lại
      else if (typedProxy) {
        const hasAuth = /@|^[^/]+:\d+:[^:]+:/.test(typedProxy.replace(/^[a-z0-9]+:\/\//i, ""));
        if (hasAuth) gpmWrite = typedProxy;
      }
      if (!creating) out.version = c.version;
      save.disabled = true; save.textContent = creating ? "Đang tạo…" : "Đang lưu…"; msg.textContent = ""; msg.className = "ccu-msg";
      if (gpmWrite) {
        const pid = String(out.gpmProfileId || raw.gpmProfileId || "").trim();
        if (!pid) { save.disabled = false; save.textContent = "Lưu thay đổi"; msg.className = "ccu-msg err"; msg.textContent = "Chọn GPM Profile trước khi nhập proxy có user/mật khẩu (proxy được lưu vào profile)."; return; }
        const w = await api().gpmSetProfileProxy(pid, gpmWrite).catch((er) => ({ ok: false, error: er.message }));
        if (!w || !w.ok) { save.disabled = false; save.textContent = "Lưu thay đổi"; msg.className = "ccu-msg err"; msg.textContent = "Không ghi được proxy vào GPM: " + ((w && w.error) || "lỗi"); return; }
        out.proxy = w.addr; // chỉ scheme://host:port
      }
      // Lưu khóa AI (nếu có đổi) trước; khóa sai/không lưu được thì dừng và báo ngay, không lưu kênh nửa vời.
      if (saveAiKey) {
        const kr = await saveAiKey();
        if (!kr.ok) { save.disabled = false; save.textContent = creating ? "Tạo kênh" : "Lưu thay đổi"; msg.className = "ccu-msg err"; msg.textContent = kr.error; return; }
      }
      const r = creating
        ? await api().channelsCreate(out).catch((er) => ({ ok: false, error: er.message }))
        : await api().channelsUpdate(c.id, out).catch((er) => ({ ok: false, error: er.message }));
      if (r && r.ok && creating) { close(); await load(); listeners.forEach((cb) => { try { cb(r.channel); } catch { /* ignore */ } }); return; }
      if (r && r.ok) {
        msg.textContent = "Đã lưu"; msg.className = "ccu-msg ok";
        window.appToast && window.appToast("Đã lưu cấu hình kênh", { kind: "success" });
        listeners.forEach((cb) => { try { cb(r.channel); } catch { /* ignore */ } });
        // nạp lại để hiện cảnh báo/hạn proxy mới nhất, giữ hộp thoại mở
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { rerender(nc); const s2 = m.querySelector(".ccu-msg"); if (s2) { s2.textContent = "Đã lưu"; s2.className = "ccu-msg ok"; } }
        return;
      }
      save.disabled = false; save.textContent = creating ? "Tạo kênh" : "Lưu thay đổi";
      msg.className = "ccu-msg err";
      if (r && r.status === 409 && (creating || r.code)) { msg.textContent = r.error || "Trùng tên hoặc GPM Profile"; }
      else if (r && r.status === 409) {
        msg.textContent = "Kênh vừa được sửa ở nơi khác (web hoặc máy khác). Đã nạp lại bản mới, hãy kiểm tra rồi sửa tiếp.";
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { rerender(nc); const s2 = m.querySelector(".ccu-msg"); if (s2) { s2.textContent = "Kênh vừa được sửa ở nơi khác. Đã nạp lại bản mới."; s2.className = "ccu-msg err"; } }
      } else if (r && r.offline) {
        st.offline = true; msg.textContent = "Mất kết nối tới máy chủ, chưa lưu được. Kiểm tra mạng rồi thử lại."; save.disabled = true;
      } else msg.textContent = (r && r.error) || "Không lưu được";
    });
    setTimeout(() => { const f = $("ccu-videosPerDay") || form.querySelector("input,select"); if (f) f.focus(); }, 50);
  }

  // ---------------------------------------------------------------- tạo kênh mới
  // Dùng lại đúng form sửa với một bản ghi rỗng: có thêm ô Tên kênh; Lưu = tạo mới.
  async function openCreate(defaults = {}) {
    const m = ensureModal();
    m.replaceChildren(el("div", { class: "ccu-card" }, head("Thêm kênh"), el("div", { class: "ccu-body", text: "Đang tải…" }))); m.classList.add("active");
    const r = await load();
    if (!r || !r.ok) { m.replaceChildren(el("div", { class: "ccu-card" }, head("Thêm kênh"), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: (r && r.error) || "Không tải được" })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" })))); return; }
    const blank = { id: 0, name: "", enabled: true, uploadEnabled: true, videosPerDay: 1, renderMode: "topTransparent", videoSource: "download", sourceHandle: "", channelUrl: "", postTimes: "", gpmProfileId: "", proxy: "", monetized: false, presetName: "", params: {}, version: 0, warnings: [], ...defaults };
    render(blank, { create: true });
  }
  async function removeChannel(c) {
    if (!(await window.appConfirm({ title: "Xóa kênh?", message: "Xóa kênh “" + c.name + "” khỏi hệ thống?", detail: "Danh sách video của kênh cũng bị xóa. Không hoàn tác được.", confirmText: "Xóa kênh" }))) return { ok: false, canceled: true };
    const r = await api().channelsDelete(c.id).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) { close(); listeners.forEach((cb) => { try { cb(null); } catch { /* ignore */ } }); }
    return r;
  }

  // ---------------------------------------------------------------- nhập Excel (xem trước rồi mới ghi)
  async function openImport() {
    const pick = await api().channelsImportPick().catch((e) => ({ ok: false, error: e.message }));
    if (!pick || pick.canceled) return;
    const m = ensureModal(); m.classList.add("active");
    const done = () => { close(); load().then(() => listeners.forEach((cb) => { try { cb(null); } catch { /* ignore */ } })); };
    const fail = (msg) => m.replaceChildren(el("div", { class: "ccu-card" }, head("Nhập từ Excel"), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: msg })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }))));
    if (!pick.ok) return fail(pick.error || "Không đọc được file");
    m.replaceChildren(el("div", { class: "ccu-card" }, head("Nhập từ Excel"), el("div", { class: "ccu-body", text: "Đang kiểm tra file…" })));
    const pv = await api().channelsImport(pick.rows, { apply: false }).catch((e) => ({ ok: false, error: e.message }));
    if (!pv || !pv.ok) return fail((pv && pv.error) || "Không kiểm tra được file");
    const plan = pv.plan, sm = plan.summary;
    const body = el("div", { class: "ccu-body" });
    body.append(el("div", { class: "ccu-note", text: pick.file.split(/[\/]/).pop() + ": " + sm.create + " kênh mới, " + sm.update + " cập nhật, " + sm.unchanged + " không đổi, " + sm.skip + " bỏ qua, " + sm.error + " lỗi." }));
    if (plan.sanitized && plan.sanitized.droppedColumns && plan.sanitized.droppedColumns.length) body.append(el("div", { class: "ccu-note warn", text: "Đã bỏ cột chứa tài khoản/mật khẩu: " + plan.sanitized.droppedColumns.join(", ") + " (không bao giờ lưu lên server)." }));
    if (plan.sanitized && plan.sanitized.proxyCredentialsFound) body.append(el("div", { class: "ccu-note warn", text: "Đã cắt user/mật khẩu proxy ở " + plan.sanitized.proxyCredentialsFound + " dòng, chỉ giữ ip:port." }));
    const bad = (plan.items || []).filter((i) => i.action === "error");
    if (bad.length) body.append(el("ul", { class: "ccu-err" }, bad.slice(0, 12).map((i) => el("li", { text: "Dòng " + i.rowNo + " (" + (i.name || "?") + "): " + (i.errors || []).join("; ") }))));
    const msg = el("div", { class: "ccu-msg", role: "alert" });
    const can = sm.create + sm.update > 0;
    const go = el("button", { class: "btn btn-primary", type: "button", text: can ? "Nhập " + (sm.create + sm.update) + " kênh" : "Không có gì để nhập", disabled: !can });
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = "Đang nhập…";
      const r = await api().channelsImport(pick.rows, { apply: true }).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok) { done(); return; }
      go.disabled = false; go.textContent = "Thử lại"; msg.className = "ccu-msg err"; msg.textContent = (r && r.error) || "Không nhập được";
    });
    m.replaceChildren(el("div", { class: "ccu-card" }, head("Nhập từ Excel", "Xem trước, chưa ghi gì"), body, el("div", { class: "ccu-foot" }, msg, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Hủy" }), go)));
  }

  function proxyLine(c) {
    const d = c.proxyDaysLeft;
    if (d === null || d === undefined) return "Proxy: chưa rõ hạn";
    return d <= 0 ? "Proxy đã hết hạn" : `Proxy còn ${d} ngày`;
  }

  // ---------------------------------------------------------------- tiện ích cho thẻ kênh
  /** Thông tin đã lưu của một kênh (để thẻ hiện ngày hết hạn proxy, số video đã đăng) sau lần tải gần nhất. */
  async function mount(host, name, { refresh = false } = {}) {
    if (refresh || !st.data) { host.replaceChildren(el("div", { class: "cv-empty", text: "Đang tải…" })); const r = await load(); if (!r || !r.ok) { host.replaceChildren(el("div", { class: "cv-empty", text: (r && r.error) || "Không tải được cấu hình kênh" })); return false; } }
    const c = st.byName.get(name);
    if (!c) { host.replaceChildren(el("div", { class: "cv-empty", text: "Không thấy kênh này trên web cho máy này. Có thể đã bị xóa hoặc chuyển máy." })); return false; }
    render(c, { host }); return true;
  }
  window.ChannelConfigUI = {
    open, load, close, mount, openCreate, openImport,
    get: (name) => st.byName.get(name) || null,
    isOffline: () => st.offline,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    proxyLine,
  };
})();
