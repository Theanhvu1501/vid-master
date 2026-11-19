// Template đầy đủ ⚙config: lấy file gốc (59 cột, màu theo mode, ghi chú từng cột, ô đóng băng) rồi THÊM các cột
// tự động hoá bằng cách sửa thẳng XML trong file xlsx. Không đọc-ghi lại bằng thư viện bảng tính vì sẽ mất
// màu/ghi chú (xlsx bản miễn phí không giữ style, exceljs không nạp được file này).

import fs from "fs";
import JSZip from "jszip";
import XLSX from "xlsx";
import { COLUMN_LABELS as L, COLUMN_GROUPS } from "./channel-sheet.js";

const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const argb = (hex) => "FF" + String(hex).replace("#", "").toUpperCase();
const withXlsx = (p) => (/\.xlsx$/i.test(p) ? p : `${p}.xlsx`);

// Kiểu ô của template gốc dùng làm khuôn: dải nhóm (dòng 1) và tiêu đề cột (dòng 2).
const BAND_XF = 11;
const HEAD_XF = 15;

export async function writeFullSheetSample(srcPath, filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(srcPath));

  // Tìm file XML của tab ⚙config qua workbook.xml + rels (không giả định đó là sheet1.xml).
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const relXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheetTag = (wbXml.match(/<sheet [^>]*>/g) || []).find((t) => t.includes('name="⚙config"'));
  const rid = sheetTag && (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
  const relTag = (relXml.match(/<Relationship [^>]*>/g) || []).find((t) => t.includes(`Id="${rid}"`));
  const target = relTag && (relTag.match(/Target="([^"]+)"/) || [])[1];
  const sheetPath = target && (target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  if (!sheetPath || !zip.file(sheetPath)) throw new Error("Template đầy đủ không có tab ⚙config");

  let sheet = await zip.file(sheetPath).async("string");
  let styles = await zip.file("xl/styles.xml").async("string");

  // Tiêu đề cột đang có (dòng 2) và cột cuối cùng của sheet.
  const row2 = (sheet.match(/<row r="2"[\s\S]*?<\/row>/) || [""])[0];
  const existing = new Set([...row2.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1].trim().toLowerCase()));
  const dim = sheet.match(/<dimension ref="[A-Z]+\d+:([A-Z]+)(\d+)"/);
  if (!dim) throw new Error("Template đầy đủ: không đọc được vùng dữ liệu của ⚙config");
  const lastCol = XLSX.utils.decode_col(dim[1]);

  // Cột cần thêm, gom theo nhóm màu (đúng thứ tự COLUMN_GROUPS) để các cột cùng nhóm nằm liền nhau.
  const groups = COLUMN_GROUPS
    .map((g) => ({ g, cols: g.keys.filter((k) => L[k] && !existing.has(L[k].toLowerCase())) }))
    .filter((x) => x.cols.length);
  const out = withXlsx(filePath);
  if (!groups.length) { fs.copyFileSync(srcPath, out); return out; }

  // --- styles: mỗi nhóm thêm 2 fill (dải nhóm đậm, tiêu đề nhạt) và 2 kiểu ô nhân bản từ khuôn của template ---
  const fillsTag = styles.match(/<fills count="(\d+)">/);
  const xfsTag = styles.match(/<cellXfs count="(\d+)">/);
  if (!fillsTag || !xfsTag) throw new Error("Template đầy đủ: styles.xml không đúng cấu trúc dự kiến");
  let fillCount = +fillsTag[1];
  let xfCount = +xfsTag[1];
  const xfList = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*?\/>|<xf [^>]*[^\/]>[\s\S]*?<\/xf>/g) || [];
  if (xfList.length <= HEAD_XF) throw new Error("Template đầy đủ: thiếu kiểu ô mẫu để nhân bản");
  const cloneWithFill = (xf, fillId) => xf.replace(/fillId="\d+"/, `fillId="${fillId}"`).replace(/ applyFill="\d"/, "").replace(/^<xf /, '<xf applyFill="1" ');

  const newFills = [], newXfs = [], style = {};
  for (const { g } of groups) {
    const bandFill = fillCount++;
    const tintFill = fillCount++;
    newFills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(g.band)}" /></patternFill></fill>`);
    newFills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(g.tint)}" /></patternFill></fill>`);
    style[g.id] = { band: xfCount++, head: xfCount++ };
    newXfs.push(cloneWithFill(xfList[BAND_XF], bandFill), cloneWithFill(xfList[HEAD_XF], tintFill));
  }
  styles = styles
    .replace(fillsTag[0], `<fills count="${fillCount}">`).replace("</fills>", `${newFills.join("")}</fills>`)
    .replace(xfsTag[0], `<cellXfs count="${xfCount}">`).replace("</cellXfs>", `${newXfs.join("")}</cellXfs>`);

  // --- sheet: ô dòng 1 (dải nhóm), dòng 2 (tên cột), độ rộng cột, gộp ô dải nhóm, mở rộng vùng lọc ---
  let r1 = "", r2 = "", colsXml = "", merges = "", mergeN = 0, c = lastCol + 1;
  for (const { g, cols } of groups) {
    const first = c;
    cols.forEach((key, idx) => {
      const name = XLSX.utils.encode_col(c);
      r1 += idx === 0
        ? `<c r="${name}1" s="${style[g.id].band}" t="inlineStr"><is><t>${escXml(g.label)}</t></is></c>`
        : `<c r="${name}1" s="${style[g.id].band}" />`;
      r2 += `<c r="${name}2" s="${style[g.id].head}" t="inlineStr"><is><t>${escXml(L[key])}</t></is></c>`;
      colsXml += `<col width="${Math.max(14, Math.min(26, L[key].length + 6))}" customWidth="1" min="${c + 1}" max="${c + 1}" />`;
      c++;
    });
    if (cols.length > 1) { merges += `<mergeCell ref="${XLSX.utils.encode_col(first)}1:${XLSX.utils.encode_col(c - 1)}1" />`; mergeN++; }
  }
  const newLast = XLSX.utils.encode_col(c - 1);

  const append = (xml, rowNum, cells) => {
    const re = new RegExp(`(<row r="${rowNum}"[\\s\\S]*?)</row>`);
    if (!re.test(xml)) throw new Error(`Template đầy đủ: không thấy dòng ${rowNum} của ⚙config`);
    return xml.replace(re, (_m, head) => `${head}${cells}</row>`);
  };
  sheet = append(append(sheet, 1, r1), 2, r2)
    .replace("</cols>", `${colsXml}</cols>`)
    .replace(/<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"/, `<dimension ref="A1:${newLast}$1"`)
    .replace(/<autoFilter ref="([A-Z]+\d+):[A-Z]+(\d+)"/, `<autoFilter ref="$1:${newLast}$2"`);
  if (mergeN) {
    const mc = sheet.match(/<mergeCells count="(\d+)">/);
    sheet = mc
      ? sheet.replace(mc[0], `<mergeCells count="${+mc[1] + mergeN}">`).replace("</mergeCells>", `${merges}</mergeCells>`)
      : sheet.replace("</sheetData>", `</sheetData><mergeCells count="${mergeN}">${merges}</mergeCells>`);
  }

  // createFolders:false: không để JSZip thêm mục thư mục rỗng, file giữ sạch như bản gốc.
  zip.file(sheetPath, sheet, { createFolders: false });
  zip.file("xl/styles.xml", styles, { createFolders: false });
  fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", createFolders: false }));
  return out;
}
