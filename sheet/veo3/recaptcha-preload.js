import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './async-utils.js';

// IS_DEV: detect if running in development mode
const IS_DEV = !process.env.APP_RESOURCES_PATH && !process.resourcesPath;

const HIJACK_BYPASS_SCRIPT = 'hijack_bypass.js';
const hijackBypassInstalledPages = new WeakSet();
export function resolveVeo3RecaptchaAssetDir(resourcesPath = process.env.APP_RESOURCES_PATH, isDev = IS_DEV) {
    // In vid-master, assets are in the same folder: ./recaptcha-assets
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'recaptcha-assets');
}
function resolveVeo3RecaptchaAssetSource(name, assetDir) {
    const assetPath = path.join(assetDir, name);
    if (!fs.existsSync(assetPath)) {
        throw new Error(`Veo3 reCAPTCHA asset thiếu ${name}; chạy npm run build:browser rồi thử lại.`);
    }
    return fs.readFileSync(assetPath, 'utf8');
}
/**
 * Installs the Flow x2a hijack bypass (veo3-recaptcha-preload/hijack_bypass.js).
 *
 * The script traps grecaptcha.enterprise.execute and captures the pristine
 * implementation before Flow's x2a trap replaces it with the
 * extension_hijack_detected action. It is registered with
 * evaluateOnNewDocument so every future navigation runs it at document_start
 * (the CDP equivalent of a MAIN-world manifest content script), and evaluated
 * once on the current document so a page that already loaded still exposes
 * window.__fk_hijack (trapped state → assign-neuter fallback).
 */
export async function installVeo3HijackBypass(page, assetDir = resolveVeo3RecaptchaAssetDir()) {
    if (hijackBypassInstalledPages.has(page))
        return;
    hijackBypassInstalledPages.add(page);
    const source = resolveVeo3RecaptchaAssetSource(HIJACK_BYPASS_SCRIPT, assetDir);
    await page.evaluateOnNewDocument(source);
    const alreadyInstalled = await page.evaluate(() => Boolean(window.__fk_hijack));
    if (!alreadyInstalled) {
        await page.evaluate(source);
    }
}
export async function preloadVeo3Recaptcha(page, assetDir = resolveVeo3RecaptchaAssetDir()) {
    await installVeo3HijackBypass(page, assetDir);
    const alreadyLoaded = await page.evaluate(() => Boolean(window.__veo3RecaptchaPreloaded));
    if (alreadyLoaded)
        return;
    const sources = ['recaptcha_enterprise.js', 'recaptcha__en.js'].map((name) => resolveVeo3RecaptchaAssetSource(name, assetDir));
    try {
        await page.evaluate(sources[0]);
    }
    catch (error) {
        if (!(error instanceof Error) || !error.message.includes('TrustedScriptURL'))
            throw error;
    }
    await sleep(50);
    await page.evaluate(sources[1]);
    try {
        await page.waitForFunction(() => {
            const enterprise = window.grecaptcha?.enterprise;
            return typeof enterprise?.ready === 'function' &&
                typeof enterprise.render === 'function' && typeof enterprise.execute === 'function';
        }, { timeout: 15000 });
    }
    catch {
        throw new Error('Veo3 reCAPTCHA preload không hoạt động trên tab Flow; chưa gửi yêu cầu tạo ảnh.');
    }
    await page.evaluate(() => { window.__veo3RecaptchaPreloaded = true; });
}
