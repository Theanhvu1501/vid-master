// Bắt lỗi "X is not defined" TRƯỚC khi chạy app: một tên được dùng nhưng chưa khai báo hay import.
// `node --check` chỉ bắt lỗi cú pháp, còn các test thường không đi qua handler IPC của Electron nên
// cả hai đều bỏ lọt lỗi này (đã từng xảy ra: maskProxy bị bỏ khỏi import của electron-main.js).
//
// Dùng bộ kiểm tra của TypeScript (đã có sẵn trong node_modules) chạy ở chế độ checkJs, chỉ lấy
// đúng các lỗi "Cannot find name" (mã 2304) và "X is not defined"-tương đương. Không cần cài thêm gì.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ts = null;
try { ts = require("typescript"); } catch { /* không có typescript thì bỏ qua */ }

// 2304 = Cannot find name 'x'; 2552 = Cannot find name 'x'. Did you mean 'y'?
const UNDEFINED_NAME = new Set([2304, 2552]);

/**
 * Kiểm tra một đoạn mã. Trả về mảng { name, line }.
 * `lib`: thư viện kiểu có sẵn của môi trường (trình duyệt cần DOM, Node thì không).
 */
export function findUndefinedNames(code, { fileName = "x.js", browser = false, module: asModule = true } = {}) {
  const opts = {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, noResolve: true, types: [],
    target: ts.ScriptTarget.ES2022,
    module: asModule ? ts.ModuleKind.ESNext : ts.ModuleKind.None,
    lib: browser ? ["lib.es2022.d.ts", "lib.dom.d.ts"] : ["lib.es2022.d.ts"],
    strict: false,
  };
  const host = ts.createCompilerHost(opts);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, ...rest) => (path.basename(f) === fileName
    ? ts.createSourceFile(f, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
    : orig(f, ...rest));
  const prog = ts.createProgram([path.join(ROOT, "__virtual__", fileName)], opts, {
    ...host,
    fileExists: (f) => path.basename(f) === fileName || host.fileExists(f),
    readFile: (f) => (path.basename(f) === fileName ? code : host.readFile(f)),
  });
  const sf = prog.getSourceFile(path.join(ROOT, "__virtual__", fileName));
  const out = [];
  for (const d of prog.getSemanticDiagnostics(sf)) {
    if (!UNDEFINED_NAME.has(d.code)) continue;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const name = (msg.match(/'([^']+)'/) || [])[1] || "?";
    const { line } = sf.getLineAndCharacterOfPosition(d.start);
    out.push({ name, line: line + 1 });
  }
  return out;
}

// Tên Node chỉ có khi khai báo kiểu của Node; vì bỏ @types nên tự liệt kê để không báo nhầm.
const NODE_PRELUDE = `
declare const require: any, module: any, exports: any, __dirname: string, __filename: string;
declare const process: any, Buffer: any, global: any;
declare const AbortController: any, TextEncoder: any, TextDecoder: any, URL: any, URLSearchParams: any;
declare function setTimeout(...a: any[]): any; declare function clearTimeout(...a: any[]): any;
declare function setInterval(...a: any[]): any; declare function clearInterval(...a: any[]): any;
declare function setImmediate(...a: any[]): any; declare function clearImmediate(...a: any[]): any;
declare function queueMicrotask(f: any): void; declare function fetch(...a: any[]): Promise<any>;
declare function structuredClone<T>(v: T): T;
declare const console: any, performance: any;
`;
const lintFile = (rel, opts) => {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^﻿/, "");
  // Phần khai báo đặt ở CUỐI để không lệch số dòng của file thật.
  const prelude = opts.browser ? "" : NODE_PRELUDE.replace(/\n/g, " ");
  return findUndefinedNames(code + "\n/** @typedef {any} __x */\n" + prelude.replace(/declare /g, "// "), opts)
    .filter(() => true);
};

const fmt = (list) => list.slice(0, 8).map((p) => `${p.name} (dòng ${p.line})`).join("; ");

// ---- kiểm chứng chính công cụ: phải bắt được lỗi giống maskProxy ----
test("bộ quét bắt được tên chưa khai báo (kiểm chứng chính công cụ)", { skip: !ts }, () => {
  const bad = `import { a } from "x";\nexport function f() { return a + maskProxy(1); }\n`;
  const found = findUndefinedNames(bad, { browser: false });
  assert.ok(found.some((p) => p.name === "maskProxy" && p.line === 2), JSON.stringify(found));

  const good = `import { a, maskProxy } from "x";\nexport function f({ k = a } = {}, ...r) { const { z } = r; try {} catch (e) { return maskProxy(e) + z + k; } }\n`;
  assert.deepEqual(findUndefinedNames(good, { browser: false }), []);
});

// Tên global của môi trường được khai báo thủ công ở trên cho file Node; ở đây chỉ kiểm tra tên
// KHÔNG phải global nào. Để tránh báo nhầm với API Node, ta lọc theo danh sách tên Node hợp lệ.
const NODE_OK = new Set(["require","module","exports","__dirname","__filename","process","Buffer","global","AbortController","TextEncoder","TextDecoder","URL","URLSearchParams","setTimeout","clearTimeout","setInterval","clearInterval","setImmediate","clearImmediate","queueMicrotask","fetch","structuredClone","console","performance"]);

const MODULES = [
  "electron-main.js",
  "sheet/youtube-automation.js", "sheet/create-channel.js", "sheet/channel-sheet.js", "sheet/excel-import.js",
  "sheet/add-channel.js", "sheet/proxy-tools.js", "sheet/distribute.js", "sheet/gpm-client.js",
  "sheet/sheets-service.js", "sheet/schedule-slots.js",
];
for (const rel of MODULES) {
  test(`không có tên chưa khai báo: ${rel}`, { skip: !ts }, () => {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^﻿/, "");
    const bad = findUndefinedNames(code, { browser: false }).filter((p) => !NODE_OK.has(p.name));
    assert.deepEqual(bad, [], `${rel}: ${fmt(bad)}`);
  });
}

test("không có tên chưa khai báo: preload.cjs", { skip: !ts }, () => {
  const code = fs.readFileSync(path.join(ROOT, "preload.cjs"), "utf8");
  const bad = findUndefinedNames(code, { fileName: "preload.cjs.js", browser: false, module: false }).filter((p) => !NODE_OK.has(p.name));
  assert.deepEqual(bad, [], fmt(bad));
});

for (const rel of ["renderer.js", "composer-ui.js"]) {
  test(`không có tên chưa khai báo: ${rel}`, { skip: !ts }, () => {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^﻿/, "");
    // appToast/appConfirm do app-dialog.cjs cấp, nạp trước renderer.js (xem renderer.html)
    const PROVIDED = new Set(["appToast", "appConfirm", "appChoose"]);
    const bad = findUndefinedNames(code, { fileName: rel, browser: true, module: false }).filter((p) => !PROVIDED.has(p.name));
    assert.deepEqual(bad, [], `${rel}: ${fmt(bad)}`);
  });
}
