// Nhập dữ liệu từ file Excel cho các chức năng Tự động hóa chạy trên profile GPM.
//
// Mỗi dòng Excel gắn với một profile bằng cột A. Cột A nhận PROFILE ID (khuyên dùng, không bao giờ trùng)
// hoặc TÊN profile. Tên profile trong GPM có thể trùng nhau, nên ghép theo tên chỉ được phép khi tên đó
// chỉ có ĐÚNG MỘT profile trong GPM — nếu không sẽ bỏ qua và báo, tuyệt đối không đoán.

import XLSX from "xlsx";

const str = (v) => String(v ?? "").trim();

function readRows(file) {
  const wb = XLSX.readFile(file);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
}

/** Đọc bảng thô của sheet đầu tiên (mảng các dòng, mỗi dòng là mảng ô dạng chuỗi) để gửi cho server nhận diện cột. */
export function readSheetRows(file) {
  return readRows(file).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
}

// File đăng nhập: A=Profile ID hoặc tên profile, B=Gmail, C=mật khẩu, D=mail khôi phục, E=mã 2FA (secret).
// Dòng nào cột B không có "@" (vd. dòng tiêu đề, dòng chưa điền tài khoản) thì bỏ qua.
export function readLoginAccounts(file) {
  const out = [];
  for (const r of readRows(file)) {
    const email = str(r[1]);
    if (!email.includes("@")) continue;
    out.push({
      profileName: str(r[0]), email, password: str(r[2]), recoveryEmail: str(r[3]), twoFactorSecret: str(r[4]),
    });
  }
  return out;
}

// Dòng tiêu đề của file mẫu ("Profile ID hoặc tên profile", "Tên profile (GPM)"...) không phải dữ liệu.
// Chỉ nhận đúng các cụm này để profile thật tên "Profile 01" không bị bỏ nhầm.
const foldText = (v) => str(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const isPlanHeader = (v) => /^(ten profile|profile name|profile id|id profile)\b/.test(foldText(v));

// File tạo channel (cùng thứ tự cột với script GPM 02.auto_create_channel):
// A=Profile ID hoặc tên profile, B=tên kênh, C=mô tả kênh, D=mô tả video mặc định, E=tag, F=handle.
// Dòng thiếu cột A hoặc tên kênh thì bỏ qua.
export function readChannelPlans(file) {
  const out = [];
  for (const r of readRows(file)) {
    const profileName = str(r[0]), title = str(r[1]);
    if (isPlanHeader(r[0])) continue;
    if (!profileName || !title) continue;
    out.push({ profileName, title, description: str(r[2]), videoDescription: str(r[3]), tags: str(r[4]), handle: str(r[5]) });
  }
  return out;
}

// File đổi GA: A=Profile ID hoặc tên profile, B=Channel ID (UC...), C=Email GA đích, D=Tên Brand Account đích.
// Dòng thiếu cột A thì bỏ qua. Các cột khác tuỳ chọn.
export function readChangeGAPlans(file) {
  const out = [];
  for (const r of readRows(file)) {
    const profileName = str(r[0]);
    if (isPlanHeader(r[0])) continue;
    if (!profileName) continue;
    out.push({ profileName, channelId: str(r[1]), targetEmail: str(r[2]), targetName: str(r[3]) });
  }
  return out;
}

const lower = (s) => str(s).toLowerCase();

/** Đếm số profile theo tên (không phân biệt hoa thường) trong TOÀN BỘ GPM, để biết tên nào bị trùng. */
export function countNames(allProfiles) {
  const m = new Map();
  for (const p of allProfiles || []) m.set(lower(p.name), (m.get(lower(p.name)) || 0) + 1);
  return m;
}

/**
 * Ghép dữ liệu Excel vào các profile đã chọn. Thứ tự ưu tiên:
 *   1. Profile ID (cột A bằng ID của profile) — chắc chắn đúng.
 *   2. Tên profile — CHỈ khi tên đó không trùng với profile nào khác trong GPM (theo `nameCounts`).
 * @returns {{ matched: object[], missing: string[], ambiguous: string[], duplicated: string[] }}
 *   matched   : profile kèm `data` (mục Excel) và `by` ("id" | "name")
 *   missing   : Excel không có dòng nào cho profile này
 *   ambiguous : Excel có từ 2 dòng trở lên cùng khoá (không tự chọn dòng nào)
 *   duplicated: tên profile trùng với profile khác trong GPM nên không được ghép theo tên
 */
export function attachProfileData(profiles, items, nameCounts = new Map()) {
  const byKey = new Map();
  for (const it of items) {
    const k = lower(it.profileName);
    byKey.set(k, [...(byKey.get(k) || []), it]);
  }
  const matched = [], missing = [], ambiguous = [], duplicated = [];
  for (const p of profiles) {
    const label = p.label || p.name;
    const byId = byKey.get(lower(p.id)) || [];
    if (byId.length === 1) { matched.push({ ...p, data: byId[0], by: "id" }); continue; }
    if (byId.length > 1) { ambiguous.push(label); continue; }

    const nameKey = lower(p.name);
    if ((nameCounts.get(nameKey) || 0) > 1) { duplicated.push(label); continue; }
    const list = byKey.get(nameKey) || [];
    if (list.length === 1) matched.push({ ...p, data: list[0], by: "name" });
    else if (list.length > 1) ambiguous.push(label);
    else missing.push(label);
  }
  return { matched, missing, ambiguous, duplicated };
}
