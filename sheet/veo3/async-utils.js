export class AsyncMutex {
    _queue = [];
    _locked = false;
    async acquire() {
        if (!this._locked) {
            this._locked = true;
            return;
        }
        return new Promise((resolve) => {
            this._queue.push(resolve);
        });
    }
    release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next();
        }
        else {
            this._locked = false;
        }
    }
}
export class AsyncSemaphore {
    queue = [];
    available;
    constructor(limit) {
        if (!Number.isInteger(limit) || limit < 1)
            throw new Error('Semaphore limit must be a positive integer.');
        this.available = limit;
    }
    async run(task, signal) {
        await this.acquire(signal);
        try {
            return await task();
        }
        finally {
            this.release();
        }
    }
    async acquire(signal) {
        throwIfAborted(signal);
        if (this.available > 0) {
            this.available -= 1;
            return;
        }
        await new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal };
            entry.onAbort = () => {
                const index = this.queue.indexOf(entry);
                if (index >= 0)
                    this.queue.splice(index, 1);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', entry.onAbort, { once: true });
            this.queue.push(entry);
        });
    }
    release() {
        const next = this.queue.shift();
        if (next) {
            if (next.onAbort)
                next.signal?.removeEventListener('abort', next.onAbort);
            next.resolve();
        }
        else
            this.available += 1;
    }
}
export function startProgressPulse(send, options) {
    let progress = options.from;
    send({
        step: options.step,
        progress,
        message: options.message,
    });
    return setInterval(() => {
        progress = Math.min(options.to, progress + 1);
        send({
            step: options.step,
            progress,
            message: progress >= options.to ? 'Google Labs vẫn đang xử lý, vui lòng chờ thêm...' : options.message,
        });
    }, options.intervalMs ?? 2500);
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function createStratifiedDelaySchedule(itemCount, range, random = Math.random) {
    const count = Math.max(0, Math.floor(itemCount));
    if (count === 0)
        return [];
    const minMs = range.min * 1000;
    const maxMs = range.max * 1000;
    if (count === 1)
        return [Math.round(minMs + clampRandom(random()) * (maxMs - minMs))];
    if (minMs === maxMs)
        return Array.from({ length: count }, () => minMs);
    const bucketWidth = (maxMs - minMs) / count;
    return Array.from({ length: count }, (_, index) => {
        const bucketStart = minMs + index * bucketWidth;
        const innerStart = bucketStart + bucketWidth * 0.25;
        return Math.round(innerStart + clampRandom(random()) * bucketWidth * 0.5);
    });
}
function clampRandom(value) {
    return Math.min(1, Math.max(0, value));
}
export function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');
}
export function sleepAbortable(ms, signal) {
    if (!signal)
        return sleep(ms);
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', onAbort);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
export async function waitForPromiseWithSignal(promise, signal) {
    if (!signal)
        return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (err) => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
        });
    });
}
