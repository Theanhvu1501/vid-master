import { VEO3_RECAPTCHA_SITE_KEY } from './constants.js';
import { AsyncSemaphore } from './async-utils.js';
import { createLogger } from './logger.js';
import { preloadVeo3Recaptcha } from './recaptcha-preload.js';
const log = createLogger('Veo 3');
const pageMintLocks = new WeakMap();
// Runs inside the Flow page via page.evaluate, so it must stay self-contained:
// puppeteer serializes only this function and its nested helpers, never module
// imports. The mint tries, in order:
//   1. pristine — grecaptcha.enterprise.execute captured by
//      hijack_bypass.js before Flow's x2a trap replaced it;
//   2. assign_neuter — x2a's wrapper poisons the action through
//      Object.assign, so temporarily neuter Object.assign;
//   3. legacy_widget — the original invisible-widget path.
export async function mintVeo3WidgetToken(input) {
    const win = window;
    const resolveSiteKey = () => Object.values(win.___grecaptcha_cfg?.clients ?? {})
        .find((client) => typeof client?.sitekey === 'string' && client.sitekey.length > 0)?.sitekey
        ?? input.fallbackSiteKey;
    const waitEnterpriseReady = (timeoutMs) => new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) {
            done = true;
            resolve();
        } };
        try {
            win.grecaptcha?.enterprise?.ready(finish);
        }
        catch {
            /* ignore */
        }
        setTimeout(finish, timeoutMs);
    });
    const executeWithPristine = async (pristine, siteKey) => {
        const token = await Promise.race([
            Promise.resolve(pristine(siteKey, { action: input.action })),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('reCAPTCHA execute hang')), input.timeoutMs);
            }),
        ]);
        return token ? String(token) : null;
    };
    const executeWithAssignNeuter = async (siteKey) => {
        const realAssign = Object.assign.bind(Object);
        Object.assign = function (target, ...sources) {
            const result = realAssign(target, ...sources);
            if (result && typeof result === 'object' && result.action === 'extension_hijack_detected') {
                result.action = input.action;
            }
            return result;
        };
        try {
            await waitEnterpriseReady(2500);
            const token = await Promise.race([
                Promise.resolve(win.grecaptcha?.enterprise?.execute(siteKey, { action: input.action })),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('reCAPTCHA execute hang')), input.timeoutMs);
                }),
            ]);
            return token ? String(token) : null;
        }
        finally {
            Object.assign = realAssign;
        }
    };
    const executeWithLegacyWidget = async (siteKey) => {
        const enterprise = win.grecaptcha?.enterprise;
        if (!enterprise || typeof enterprise.ready !== 'function' ||
            typeof enterprise.render !== 'function' || typeof enterprise.execute !== 'function') {
            throw new Error('reCAPTCHA Enterprise widget not available on Flow page');
        }
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('reCAPTCHA ready timeout')), 5000);
            try {
                enterprise.ready(() => { clearTimeout(timer); resolve(); });
            }
            catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
        const hostId = 'veo3-recaptcha-host';
        let host = document.getElementById(hostId);
        if (!host) {
            host = document.createElement('div');
            host.id = hostId;
            host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
            document.documentElement.appendChild(host);
        }
        let widget = win.__veo3RecaptchaWidget;
        if (!widget || widget.siteKey !== siteKey) {
            host.replaceChildren();
            widget = { id: enterprise.render(host, { sitekey: siteKey, size: 'invisible', callback: () => undefined }), siteKey };
            win.__veo3RecaptchaWidget = widget;
        }
        let timer;
        try {
            const token = await Promise.race([
                Promise.resolve(enterprise.execute(widget.id, { action: input.action })),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('reCAPTCHA timeout')), input.timeoutMs);
                }),
            ]);
            return token ? String(token) : null;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    };
    const siteKey = resolveSiteKey();
    const hijack = win.__fk_hijack;
    const pristine = typeof hijack?.pristine === 'function' ? hijack.pristine : null;
    const knownTrapped = Boolean(hijack?.trapped);
    const bypassPath = pristine
        ? `pristine(${hijack?.source ?? 'unknown'})`
        : knownTrapped ? 'assign_neuter' : 'legacy_widget';
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            if (pristine) {
                const token = await executeWithPristine(pristine, siteKey);
                if (token)
                    return { token, bypassPath };
            }
            else if (knownTrapped) {
                const token = await executeWithAssignNeuter(siteKey);
                if (token)
                    return { token, bypassPath };
            }
            else {
                const token = await executeWithLegacyWidget(siteKey);
                if (token)
                    return { token, bypassPath };
            }
        }
        catch (error) {
            if (attempt === 1)
                throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
    }
    throw new Error('reCAPTCHA returned an empty token');
}
export async function getVeo3RecaptchaToken(page, action, options = {}) {
    const lock = pageMintLocks.get(page) ?? new AsyncSemaphore(1);
    pageMintLocks.set(page, lock);
    return lock.run(() => getVeo3RecaptchaTokenInner(page, action), options.signal);
}
async function getVeo3RecaptchaTokenInner(page, action) {
    // Luôn preload: cài hijack_bypass trước khi Flow thay thế execute (bỏ qua bước này khiến token bị Google từ chối).
    await preloadVeo3Recaptcha(page);
    log.info('[Veo3] reCAPTCHA CDP preload ready', { action });
    try {
        await page.waitForFunction(() => {
            const win = window;
            if (typeof win.__fk_hijack?.pristine === 'function')
                return true;
            const enterprise = win.grecaptcha?.enterprise;
            return Boolean(enterprise && typeof enterprise.ready === 'function' &&
                typeof enterprise.render === 'function' &&
                typeof enterprise.execute === 'function');
        }, { timeout: 15000 });
    }
    catch {
        throw new Error('reCAPTCHA Enterprise widget not available on Flow page');
    }
    log.info('[Veo3] reCAPTCHA widget execute', { action, preload: 'loaded' });
    const minted = await page.evaluate(mintVeo3WidgetToken, {
        fallbackSiteKey: VEO3_RECAPTCHA_SITE_KEY,
        action,
        timeoutMs: 8000,
    });
    log.info('[Veo3] reCAPTCHA token minted', { action, bypassPath: minted.bypassPath });
    return minted.token;
}
