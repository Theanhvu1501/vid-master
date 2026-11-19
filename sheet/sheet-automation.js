// Tự động hoá theo Google Sheet: MỖI HÀNG KÊNH tự quyết định việc cần làm qua hai cột bật/tắt
//   "Tạo profile"  -> tạo profile GPM (Chrome 129), gán proxy, ghi GPM Profile ID về Sheet, đăng nhập
//   "Tạo channel"  -> tạo channel YouTube từ các cột Tên hiển thị / Mô tả kênh / Mô tả video / Tag / Handle kênh
// Trong app không có ô cấu hình nào: chỉ cần bấm Chạy. Ô cờ trống = không làm gì với kênh đó.
//
// Chạy lại an toàn: Profile ID được ghi NGAY sau khi tạo, và việc nào xong thì ô cờ đổi thành "xong"
// nên lượt sau bỏ qua; việc nào lỗi thì giữ nguyên cờ để thử lại.

import { readChannelRows, assertTaskColumns, makeStatusWriter, FLAG_DONE_TEXT } from "./channel-sheet.js";
import { planAddChannels, STUDIO_URL, DEFAULT_CHROME_MAJOR } from "./add-channel.js";

/**
 * Lập kế hoạch cho mọi hàng có ít nhất một cờ "on". Hàm thuần, dùng cho cả Xem trước lẫn Chạy.
 * Mỗi mục: { sheetName, rowIndex, doProfile, doChannel, steps[], action, note, ... }
 *   action: "create" | "reuse" | "channel-only" | "error"
 */
export function planSheetAutomation({ rows, profiles, defaultVersion }) {
  const active = rows.filter((r) => r.autoProfile === "on" || r.autoChannel === "on");
  const profileRows = active.filter((r) => r.autoProfile === "on");
  const profPlan = new Map(
    planAddChannels({ rows: profileRows, profiles, defaultVersion: defaultVersion || String(DEFAULT_CHROME_MAJOR) }).map((p) => [p.rowIndex, p]),
  );
  const byId = new Set(profiles.map((p) => p.id));

  return active.map((r) => {
    const doProfile = r.autoProfile === "on";
    const doChannel = r.autoChannel === "on";
    const base = { sheetName: r.sheetName, rowIndex: r.rowIndex, doProfile, doChannel, steps: [] };
    const fail = (note, extra = {}) => ({ ...base, ...extra, action: "error", note });
    const steps = [];

    let prof = null;
    if (doProfile) {
      prof = profPlan.get(r.rowIndex);
      if (!prof || prof.action === "error") return fail(prof?.note || "không lập được kế hoạch profile", prof ? { proxyMasked: prof.proxyMasked } : {});
      steps.push(prof.action === "create" ? "tạo profile" : "dùng profile có sẵn");
      if (prof.account) steps.push("đăng nhập");
    }

    let channelPlan = null;
    if (doChannel) {
      if (!doProfile) {
        if (!r.gpmProfileId) return fail('chưa có GPM Profile ID — hãy bật cả cột "Tạo profile" cho kênh này');
        if (!byId.has(r.gpmProfileId)) return fail(`Profile ID ${r.gpmProfileId} không có trong GPM`);
      }
      if (!r.channelTitle) return fail('ô "Tên hiển thị" trống — cần để tạo channel');
      channelPlan = { title: r.channelTitle, description: r.channelDesc, videoDescription: r.videoDesc, tags: r.videoTags, handle: r.channelHandle };
      steps.push("tạo channel");
    }

    const noLogin = doProfile && !prof.account ? " (không có tk nên không đăng nhập)" : "";
    return {
      ...base, steps,
      action: doProfile ? prof.action : "channel-only",
      note: steps.join(" → ") + noLogin,
      proxyMasked: prof?.proxyMasked,
      // dữ liệu chạy thật (KHÔNG đưa ra giao diện): xem previewSheetAutomation
      _prof: prof, _channel: channelPlan, _profileId: doProfile ? prof.profileId : r.gpmProfileId,
    };
  });
}

/** Xem trước cho giao diện: không lộ mật khẩu, proxy gốc hay dữ liệu chạy nội bộ. */
export async function previewSheetAutomation(o, deps) {
  const values = await deps.readValues();
  const { rows } = loadRows(values);
  const plan = planSheetAutomation({ rows, profiles: await deps.listProfiles(), defaultVersion: o.defaultVersion });
  return plan.map(({ _prof, _channel, _profileId, ...safe }) => safe);
}

function loadRows(values) {
  assertTaskColumns(values, "automation");
  const out = readChannelRows(values);
  const { cols } = out;
  if (cols.autoProfile === undefined && cols.autoChannel === undefined) {
    throw new Error('Sheet ⚙config chưa có cột "Tạo profile" hoặc "Tạo channel" — bấm "Tạo cột còn thiếu", rồi điền "có" vào kênh muốn chạy');
  }
  return out;
}

export async function runSheetAutomation(o, deps) {
  const log = o.onLog || console.log;
  const { rows, cols } = loadRows(await deps.readValues());
  const profiles = await deps.listProfiles();
  const plan = planSheetAutomation({ rows, profiles, defaultVersion: o.defaultVersion });
  if (!plan.length) throw new Error('Không có kênh nào được bật — điền "có" vào cột "Tạo profile" hoặc "Tạo channel" của kênh cần chạy');

  const writeStatus = makeStatusWriter({ writeCell: deps.writeCell, cols, key: "autoStatus" });
  const markDone = async (rowIndex, flagKey, tag) => {
    if (cols[flagKey] === undefined) return;
    try { await deps.writeCell(rowIndex, cols[flagKey], FLAG_DONE_TEXT); }
    catch (e) { log(`${tag} ⚠️ không đổi được ô "${flagKey === "autoProfile" ? "Tạo profile" : "Tạo channel"}" thành "${FLAG_DONE_TEXT}": ${e.message}`); }
  };

  const res = { total: plan.length, created: 0, reused: 0, errors: 0, browser: null };
  const work = []; // kênh cần mở trình duyệt (đăng nhập và/hoặc tạo channel)

  // ===== Giai đoạn 1: profile (tuần tự, không cần trình duyệt) =====
  for (const it of plan) {
    deps.checkCancelled?.();
    const tag = `[${it.sheetName}]`;
    if (it.action === "error") {
      res.errors++; log(`${tag} ❌ ${it.note}`);
      await writeStatus(it, { status: "error", message: it.note }).catch(() => {});
      continue;
    }

    let id = it._profileId;
    if (it.doProfile) {
      const p = it._prof;
      try {
        if (p.action === "create") {
          log(`${tag} tạo profile Chrome ${p.version}${p.proxyMasked ? `, proxy ${p.proxyMasked}` : ", KHÔNG có proxy"}`);
          ({ id } = await deps.createProfile({ name: it.sheetName, rawProxy: p.proxy, browserVersion: p.version, startupUrl: STUDIO_URL }));
          res.created++;
        } else {
          res.reused++;
          id = p.profileId;
          if (p.setProxy) { log(`${tag} gán proxy ${p.proxyMasked}`); await deps.updateProxy(id, p.proxy); }
          if (p.proxyDiffers) log(`${tag} ⚠️ proxy trong Sheet khác proxy của profile — giữ nguyên proxy của profile`);
        }
        // Ghi ID NGAY. Hỏng thì dừng cả lượt: tiếp tục sẽ tạo thêm profile mà Sheet không biết.
        if (p.action === "create" || p.writeId) {
          try { await deps.writeCell(it.rowIndex, cols.gpmProfileId, id); }
          catch (e) {
            throw Object.assign(new Error(`ĐÃ tạo/tìm profile (ID ${id}) nhưng KHÔNG ghi được vào Sheet: ${e.message}. Hãy điền ID này vào ô "GPM Profile ID" của dòng ${it.rowIndex} rồi chạy lại.`), { fatal: true });
          }
        }
        if (!id) throw new Error("không xác định được GPM Profile ID sau khi tạo/tìm profile");
        log(`${tag} ✅ profile ${id}`);
      } catch (e) {
        if (e.fatal) { log(`${tag} ❌ ${e.message}`); throw e; }
        res.errors++; log(`${tag} ❌ ${e.message}`);
        await writeStatus(it, { status: "error", message: e.message }).catch(() => {});
        continue;
      }
    }

    const login = it.doProfile && it._prof.account ? it._prof.account : null;
    // Chỉ profile, không có tk để đăng nhập, không tạo channel -> xong ngay, không cần mở trình duyệt.
    if (!login && !it.doChannel) {
      await markDone(it.rowIndex, "autoProfile", tag);
      await writeStatus(it, { status: "ok", message: "đã tạo profile" }).catch(() => {});
      continue;
    }
    if (it.doProfile && !login) await markDone(it.rowIndex, "autoProfile", tag);
    work.push({ id, name: it.sheetName, rowIndex: it.rowIndex, login, channel: it._channel, doProfile: it.doProfile });
  }

  // ===== Giai đoạn 2: trình duyệt (đăng nhập, rồi tạo channel trong cùng phiên) =====
  if (work.length) {
    log(`\n🌐 Mở ${work.length} profile để ${[work.some((w) => w.login) && "đăng nhập", work.some((w) => w.channel) && "tạo channel"].filter(Boolean).join(" và ")}…`);
    res.browser = await deps.forEach({
      gpmHost: o.gpmHost, profiles: work, concurrency: 1, log,
      onResult: writeStatus,
      work: async (page, p, plog) => {
        const done = [];
        if (p.login) {
          await deps.login(page, p.login, plog);
          done.push("đăng nhập");
          if (p.doProfile) await markDone(p.rowIndex, "autoProfile", `[${p.name}]`);
        }
        deps.checkCancelled?.();
        if (p.channel) {
          await deps.createChannel(page, p.channel, plog);
          done.push("tạo channel");
          await markDone(p.rowIndex, "autoChannel", `[${p.name}]`);
        }
        return done.join(" + ");
      },
    });
  }

  const b = res.browser;
  const message = `tạo mới ${res.created}, dùng lại ${res.reused}, lỗi ${res.errors}` + (b ? `; trình duyệt ${b.ok}/${b.total} thành công` : "");
  log(`\n🏁 ${message}`);
  return { success: true, ...res, message };
}
