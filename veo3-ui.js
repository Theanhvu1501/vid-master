/* Menu "Tạo ảnh Veo3": sinh ảnh bằng Google Flow (Veo3 API).
 *
 * - Quản lý nhiều tài khoản Google, mỗi tài khoản một Chrome profile riêng.
 * - Mỗi dòng prompt là một ảnh. Chạy song song theo số account.
 * - Dùng như script thường: window.Veo3UI.mount(root).
 */
(function () {
  "use strict";
  const api = () => window.electronAPI && window.electronAPI.veo3;
  const toast = (m, kind) => { if (typeof window.appToast === "function") window.appToast(m, { kind: kind || "success" }); };

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
  const group = (label, input, help) => el("div", { class: "form-group" }, el("label", { text: label }), input, help ? el("small", { text: help }) : null);
  const ASPECT = { "16:9": "Ngang 16:9 (thumbnail YouTube)", "9:16": "Dọc 9:16", "1:1": "Vuông 1:1", "4:3": "Ngang 4:3", "3:4": "Dọc 3:4" };
  const MODEL = { "Nano Banana pro": "Nano Banana pro (nhanh)", "Nano Banana 2.1": "Nano Banana 2.1 (chất lượng cao)", "Nano Banana 2 Lite": "Nano Banana 2 Lite" };
  const STATUS = { pending: ["Chờ", ""], generating: ["Đang tạo…", "run"], done: ["Xong", "ok"], error: ["Lỗi", "err"], cancelled: ["Đã hủy", "warn"], need_login: ["Cần đăng nhập", "warn"] };

  function mount(root) {
    const st = { accounts: [], settings: {}, running: false, items: [], promptText: "", progress: {} };
    const msg = el("div", { class: "veo3-msg", role: "status", "aria-live": "polite" });
    const setMsg = (t, kind) => { msg.textContent = t || ""; msg.className = "veo3-msg" + (kind ? " " + kind : ""); };

    async function load() {
      try {
        const r = await (api()?.get?.() || Promise.resolve({ ok: false, error: "API not available" }));
        if (!r || !r.ok) {
          root.replaceChildren(el("div", { class: "card-section" },
            el("div", { class: "card-section-title", text: "🖼️ Tạo ảnh Veo3" }),
            el("small", { text: "Lỗi: " + (r?.error || "Phiên bản app này chưa hỗ trợ.") })));
          return;
        }
        st.accounts = r.accounts || [];
        st.settings = r.settings || {};
        st.running = !!r.running;
        paint();
      } catch (e) {
        root.replaceChildren(el("div", { class: "card-section" },
          el("div", { class: "card-section-title", text: "🖼️ Tạo ảnh Veo3" }),
          el("small", { text: "Lỗi: " + e.message })));
      }
    }

    // Hộp dán cookie: cookie là bí mật, chỉ gửi sang tiến trình chính để nạp vào Chrome của account, không hiện lại, không lưu trong trang.
    function openCookieBox(acc) {
      const ta = el("textarea", { rows: "7", spellcheck: "false", autocomplete: "off", placeholder: "Dán cookie đã xuất khi đang đăng nhập Google (JSON từ Cookie-Editor / EditThisCookie, hoặc Netscape cookies.txt)" });
      const out = el("div", { class: "veo3-msg", role: "status" });
      const go = el("button", { class: "btn btn-primary", type: "button", text: "Nạp cookie", onclick: async () => {
        go.disabled = true; out.className = "veo3-msg"; out.textContent = "Đang nạp cookie và kiểm tra đăng nhập Flow…";
        const r = await api().importCookies(acc.id, ta.value).catch((e) => ({ ok: false, error: e.message }));
        ta.value = ""; go.disabled = false;
        if (r && r.ok && r.loggedIn) { out.className = "veo3-msg ok"; out.textContent = "Đã nạp " + r.count + " cookie. Account đã đăng nhập Google Flow."; st.accounts = r.accounts || st.accounts; setTimeout(() => { box.remove(); paint(); }, 1200); }
        else if (r && r.ok) { out.className = "veo3-msg warn"; out.textContent = "Đã nạp " + r.count + " cookie nhưng Flow vẫn đòi đăng nhập: cookie hết hạn hoặc xuất sai lúc. Hãy xuất lại khi đang đăng nhập."; }
        else { out.className = "veo3-msg err"; out.textContent = (r && r.error) || "Không nạp được cookie."; }
      } });
      const box = el("div", { class: "card-section" }, el("div", { class: "card-section-title", text: "🍪 Nhập cookie cho " + (acc.name || acc.id.slice(0, 8)) }),
        el("div", { class: "info-box" }, el("p", { text: "Cookie giống mật khẩu: ai có nó là vào được tài khoản Google. App chỉ nạp vào Chrome của account này trên máy bạn, không lưu lại nội dung bạn dán và không gửi đi đâu." })),
        ta, el("div", { class: "veo3-actions" }, go, el("button", { class: "btn btn-secondary", type: "button", text: "Đóng", onclick: () => box.remove() })), out);
      root.prepend(box); ta.focus();
    }

    // ─── Account management ───────────────────────────────────────────────
    function accountsSection() {
      const addBtn = el("button", { class: "btn btn-secondary", type: "button", text: "+ Thêm account", onclick: async () => {
        const r = await api().addAccount().catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { setMsg(r?.error || "Không thêm được", "err"); return; }
        st.accounts = r.accounts;
        paint();
        toast("Đã thêm account. Bấm Đăng nhập để mở Chrome.");
      } });

      const rows = st.accounts.map((acc) => {
        const rest = (st.pool && st.pool[acc.id]) || 0, restMin = rest > (st.poolNow || Date.now()) ? Math.ceil((rest - (st.poolNow || Date.now())) / 60000) : 0;
        const statusText = restMin > 0 ? "⏸ Đang nghỉ ~" + restMin + " phút (hết lượt hoặc bị Google yêu cầu xác minh)" : acc.lastLoginStatus === "logged_in" ? "✓ Đã đăng nhập" :
          acc.lastLoginStatus === "logged_out" ? "✗ Chưa đăng nhập" : "? Chưa rõ";
        const statusClass = restMin > 0 ? "warn" : acc.lastLoginStatus === "logged_in" ? "ok" : acc.lastLoginStatus === "logged_out" ? "err" : "warn";

        return el("div", { class: "veo3-account-row" },
          el("div", { class: "veo3-account-info" },
            el("span", { class: "veo3-account-name", text: acc.name || acc.email || acc.id.slice(0, 8) }),
            el("span", { class: "veo3-account-status " + statusClass, text: statusText })),
          el("div", { class: "veo3-account-actions" },
            el("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Đăng nhập", onclick: async () => {
              setMsg("Đang mở Chrome...", "");
              const r = await api().openLogin(acc.id).catch((e) => ({ ok: false, error: e.message }));
              if (!r || !r.ok) { setMsg(r?.error || "Không mở được Chrome", "err"); return; }
              setMsg("Chrome đã mở. Đăng nhập Google rồi đóng cửa sổ.", "ok");
            } }),
            el("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Nhập cookie", onclick: () => openCookieBox(acc) }),
            el("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Đóng Chrome", onclick: async () => {
              await api().closeBrowser(acc.id).catch(() => {});
              setMsg("Đã đóng Chrome của account này.", "");
            } }),
            el("button", { class: "btn btn-danger btn-sm", type: "button", text: "Xóa", onclick: async () => {
              const ok = await window.appConfirm({ title: "Xóa account Veo3?", message: "Xóa account “" + (acc.name || acc.id.slice(0, 8)) + "”?", detail: "Phiên đăng nhập Google và cookie của account này trên máy sẽ bị xóa. Không hoàn tác được.", confirmText: "Xóa account" });
              if (!ok) return;
              const r = await api().removeAccount(acc.id).catch((e) => ({ ok: false, error: e.message }));
              if (!r || !r.ok) { setMsg(r?.error || "Không xóa được", "err"); return; }
              st.accounts = r.accounts;
              paint();
              toast("Đã xóa account");
            } })));
      });

      return el("div", { class: "card-section" },
        el("div", { class: "card-section-title", text: "👤 Tài khoản Google Flow" }),
        el("div", { class: "info-box" }, el("p", { text: "Thêm nhiều account: khi AI vẽ thumbnail cho các kênh, app xoay vòng giữa các account đã đăng nhập; account nào hết lượt hoặc bị Google yêu cầu xác minh sẽ nghỉ một lúc rồi chuyển sang account khác." })),
        el("div", { class: "info-box" }, el("p", { text: "Mỗi account là một phiên Chrome riêng. Thêm account → Đăng nhập → Chrome mở ra → Đăng nhập Google → Đóng Chrome." })),
        ...rows,
        addBtn);
    }

    // ─── Settings ─────────────────────────────────────────────────────────
    async function saveSettings(patch) {
      const r = await api().saveSettings(patch).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) { setMsg(r?.error || "Không lưu được", "err"); return; }
      st.settings = r.settings;
      paint();
    }

    function settingsSection() {
      const s = st.settings;
      const aspect = el("select", { id: "veo3-aspect" }, Object.entries(ASPECT).map(([v, t]) => el("option", { value: v, text: t })));
      aspect.value = s.aspectRatio || "16:9";
      const model = el("select", { id: "veo3-model" }, Object.entries(MODEL).map(([v, t]) => el("option", { value: v, text: t })));
      model.value = s.model || "Nano Banana pro";
      const parallel = el("input", { type: "number", id: "veo3-parallel", min: "1", max: "10", value: s.parallelJobs || 1 });
      const headless = el("input", { type: "checkbox", id: "veo3-headless" });
      headless.checked = s.headless !== false;

      const outputDir = el("input", { type: "text", id: "veo3-output", value: s.outputDir || "", readonly: true, placeholder: "Mặc định: thư mục veo3/output" });
      const pickOutput = el("button", { class: "btn btn-secondary", type: "button", text: "Chọn", onclick: async () => {
        const p = await window.electronAPI.selectFolder();
        if (p) await saveSettings({ outputDir: p });
      } });

      for (const [node, key] of [[aspect, "aspectRatio"], [model, "model"]]) node.addEventListener("change", () => saveSettings({ [key]: node.value }));
      parallel.addEventListener("change", () => saveSettings({ parallelJobs: Number(parallel.value) }));
      headless.addEventListener("change", () => saveSettings({ headless: headless.checked }));

      return el("div", { class: "card-section" },
        el("div", { class: "card-section-title", text: "⚙️ Cài đặt" }),
        el("div", { class: "form-grid cols-2" }, group("Tỉ lệ ảnh", aspect), group("Model", model)),
        el("div", { class: "form-grid cols-2" },
          group("Số job song song", parallel, "Tối đa bằng số account"),
          group("Chạy nền", el("label", { class: "checkbox-label" }, headless, " Ẩn Chrome (headless)"))),
        group("Thư mục lưu ảnh", el("div", { class: "folder-select" }, el("div", { class: "folder-input-wrap" }, outputDir), pickOutput)));
    }

    // ─── Prompt & Run ─────────────────────────────────────────────────────
    function resultTable() {
      if (!st.items.length) return el("small", { text: 'Chưa có kết quả. Nhập prompt rồi bấm "Tạo ảnh".' });
      return el("div", { class: "veo3-results" }, st.items.map((it, i) => {
        const prog = st.progress[i] || {};
        const status = prog.status || it.status || "pending";
        const [label, cls] = STATUS[status] || STATUS.pending;
        const progressText = prog.progress ? ` (${prog.progress}%)` : prog.message ? ` - ${prog.message}` : "";

        const head = el("div", { class: "veo3-row-head" },
          el("span", { class: "veo3-badge " + cls, text: label + progressText }),
          el("span", { class: "veo3-prompt", text: it.prompt }));
        const body = [];
        if (status === "done" && it.filePath) {
          const img = el("img", { class: "veo3-thumb", alt: "Ảnh đã tạo: " + it.prompt.slice(0, 60), width: "160", height: "90" });
          api().readImage(it.filePath).then((r) => { if (r && r.ok) img.src = r.dataUrl; }).catch(() => {});
          body.push(img, el("div", { class: "veo3-file" },
            el("span", { text: it.filePath }),
            el("button", { class: "btn btn-secondary", type: "button", text: "Mở thư mục", onclick: () => api().openFile(it.filePath) })));
        }
        if (status === "error" || status === "need_login") {
          body.push(el("div", { class: "veo3-err", text: it.error || prog.error || "Lỗi không rõ" }));
        }
        return el("div", { class: "veo3-row" }, head, ...body);
      }));
    }

    function promptSection() {
      const prompts = el("textarea", { id: "veo3-prompts", rows: "6", placeholder: "Mỗi dòng là một ảnh. Ví dụ:\nMột con mèo ngồi bên cửa sổ mưa, phong cách điện ảnh\nBãi biển hoàng hôn, màu ấm, nhiều chi tiết" });
      prompts.value = st.promptText || "";
      prompts.addEventListener("input", () => { st.promptText = prompts.value; });

      const runBtn = el("button", { class: "btn btn-primary", type: "button", id: "veo3-run", text: st.running ? "Đang chạy…" : "Tạo ảnh", disabled: st.running || st.accounts.length === 0, onclick: run });
      const stopBtn = st.running ? el("button", { class: "btn btn-secondary", type: "button", id: "veo3-stop", text: "Dừng", onclick: async () => {
        await api().stop();
        setMsg("Đã yêu cầu dừng.", "warn");
      } }) : null;

      const noAccount = st.accounts.length === 0 ? el("div", { class: "info-box warn" }, el("p", { text: "Chưa có account nào. Thêm account ở phần trên trước." })) : null;

      return el("div", { class: "card-section" },
        el("div", { class: "card-section-title", text: "✍️ Prompt" }),
        noAccount,
        group("Prompt (mỗi dòng một ảnh)", prompts, "Mỗi ảnh dùng credit của tài khoản Google Flow."),
        el("div", { class: "veo3-actions" }, runBtn, stopBtn),
        msg);
    }

    function paint() {
      root.replaceChildren(
        el("div", { class: "tab-header" }, el("h2", { text: "Tạo ảnh Veo3" })),
        accountsSection(),
        settingsSection(),
        promptSection(),
        el("div", { class: "card-section" }, el("div", { class: "card-section-title", text: "🖼️ Kết quả" }), resultTable()));
    }

    async function run() {
      const list = (st.promptText || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (!list.length) { setMsg("Chưa nhập prompt nào.", "err"); return; }
      if (st.accounts.length === 0) { setMsg("Chưa có account nào.", "err"); return; }

      const unique = [...new Set(list)];
      st.items = unique.map((prompt) => ({ prompt, status: "pending" }));
      st.progress = {};
      st.running = true;
      setMsg(unique.length + " ảnh, " + st.accounts.length + " account.");
      paint();

      const off = api().onProgress((d) => {
        if (d.promptIndex !== undefined) {
          st.progress[d.promptIndex] = d;
          if (d.status === "done" || d.status === "error" || d.status === "cancelled") {
            st.items[d.promptIndex] = { ...st.items[d.promptIndex], ...d };
          }
          paintResultsOnly();
        }
      });

      const r = await api().run(unique).catch((e) => ({ ok: false, error: e.message }));
      try { off(); } catch { /* đã gỡ */ }
      st.running = false;

      if (!r || !r.ok) { setMsg(r?.error || "Không chạy được", "err"); paint(); return; }
      st.items = r.results.map((x, i) => ({ ...st.items[i], ...x }));
      const ok = r.results.filter((x) => x.status === "done").length;
      setMsg("Xong: " + ok + "/" + r.results.length + " ảnh.", ok === r.results.length ? "ok" : "warn");
      if (ok) toast("Đã tạo " + ok + " ảnh");
      paint();
    }

    function paintResultsOnly() {
      const holder = root.querySelector(".card-section:last-child");
      if (!holder) return;
      const title = holder.firstChild;
      holder.replaceChildren(title, resultTable());
    }

    load();
    return { reload: load };
  }

  window.Veo3UI = { mount };
})();
