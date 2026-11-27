/**
 * Background scheduler for trend scans.
 * Checks every 5 minutes if any profile is due for scan.
 * Scans run sequentially (never parallel), with re-entrancy guard and timeout.
 */

import { loadProfiles, loadSchedule, saveSchedule } from "./trend-store.js";
import { runScan as defaultRunScan, ProfileAlreadyScanningError } from "./trend-research.js";

/** Check interval: 5 minutes */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Initial startup delay: 30 seconds */
const STARTUP_DELAY_MS = 30 * 1000;

/** Default scan timeout: 15 minutes. Prevents a hanging scan from freezing the scheduler forever. */
const DEFAULT_SCAN_TIMEOUT_MS = 15 * 60 * 1000;

let intervalId = null;
let startupTimerId = null;
let isRunning = false; // Re-entrancy guard for the entire tick

/**
 * Pure function to check if a profile is due for scan.
 * Exported for testing.
 *
 * @param {object} profile - Profile object with scansPerDay, apiKey
 * @param {string|null} lastRunIso - ISO timestamp of last scan, null if never scanned
 * @param {number} nowMs - Current time in milliseconds
 * @returns {boolean} true if profile is due for scan
 */
export function isDue(profile, lastRunIso, nowMs) {
  // Profile without apiKey is never due
  if (!profile || !profile.apiKey) {
    return false;
  }

  // Never scanned -> due immediately
  if (!lastRunIso) {
    return true;
  }

  // Calculate interval: 24h / scansPerDay
  // Handle missing/0/NaN scansPerDay by falling back to 1
  let scansPerDay = profile.scansPerDay;
  if (!scansPerDay || !Number.isFinite(scansPerDay) || scansPerDay <= 0) {
    scansPerDay = 1;
  }

  const intervalMs = (24 * 60 * 60 * 1000) / scansPerDay;
  const lastRunMs = new Date(lastRunIso).getTime();

  if (Number.isNaN(lastRunMs)) {
    // Invalid date -> treat as never scanned
    return true;
  }

  const nextDueMs = lastRunMs + intervalMs;
  return nowMs >= nextDueMs;
}

/**
 * Get profiles that are due for scan.
 * @returns {Array} Array of profile objects due for scan
 */
export function getProfilesDueForScan() {
  const profiles = loadProfiles();
  const schedule = loadSchedule();
  const nowMs = Date.now();

  return profiles.filter((p) => {
    const lastRun = schedule.lastRun?.[p.id] || null;
    return isDue(p, lastRun, nowMs);
  });
}

/**
 * Record a scan attempt (success or failure) for a profile.
 * This prevents immediate retry on failure - profile waits its normal interval.
 * @param {string} profileId
 */
function recordScanAttempt(profileId) {
  const schedule = loadSchedule();
  schedule.lastRun = schedule.lastRun || {};
  schedule.lastRun[profileId] = new Date().toISOString();
  saveSchedule(schedule);
}

/**
 * Wrap a scan call with a timeout.
 * On timeout, the scan may still be running (and holding its per-profile lock), but we:
 * - Log the timeout
 * - Record the attempt (so it doesn't retry every tick)
 * - Return control to continue with other profiles
 *
 * NOTE: The per-profile lock (inside runScan) is intentionally NOT released by this timeout.
 * If runScan truly hangs forever, the profile stays locked and won't be double-run.
 * The lock is only released by runScan's own finally block when it eventually completes.
 *
 * @param {function} runScanFn - The runScan function to call
 * @param {string} profileId
 * @param {object} scanOptions
 * @param {number} timeoutMs
 * @returns {Promise<object>} Scan result or throws on error/timeout
 */
async function runScanWithTimeout(runScanFn, profileId, scanOptions, timeoutMs) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Scan timeout sau ${Math.round(timeoutMs / 60000)} phút`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      runScanFn(profileId, scanOptions),
      timeoutPromise,
    ]);
    return result;
  } finally {
    // ALWAYS clear the timeout timer to prevent leaks
    clearTimeout(timeoutId);
  }
}

/**
 * Run a single tick of the scheduler.
 * Checks for due profiles and runs scans sequentially.
 * @param {object} options
 * @param {function} options.runScanFn - Injected runScan function (for testing)
 * @param {number} options.scanTimeoutMs - Timeout per scan (for testing)
 */
async function runTick({ gpmHost, log, onScanComplete, mainWindow, runScanFn, scanTimeoutMs }) {
  // Re-entrancy guard: if previous tick is still running, skip this tick entirely
  if (isRunning) {
    log("[Scheduler] Previous tick still running, skipping");
    return;
  }

  isRunning = true;

  try {
    const dueProfiles = getProfilesDueForScan();

    if (!dueProfiles.length) {
      return;
    }

    log(`[Scheduler] ${dueProfiles.length} profile(s) due for scan`);

    // Run scans SEQUENTIALLY (never parallel)
    for (const profile of dueProfiles) {
      // Double-check apiKey (should already be filtered, but safety check)
      if (!profile.apiKey) {
        log(`[Scheduler] Skipping ${profile.name}: no apiKey`);
        continue;
      }

      try {
        log(`[Scheduler] Scanning: ${profile.name}`);

        const scanOptions = {
          gpmHost,
          log,
          onProgress: (progress) => {
            // Optionally forward progress to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("trend:scan-progress", {
                profileId: profile.id,
                profileName: profile.name,
                ...progress,
              });
            }
          },
        };

        const result = await runScanWithTimeout(runScanFn, profile.id, scanOptions, scanTimeoutMs);

        // runScan calls updateLastScan on success, so we don't need to record here

        log(`[Scheduler] Completed: ${profile.name} - ${result.totalVideos} videos`);

        // Notify renderer (without leaking apiKey)
        onScanComplete?.(profile, result);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("trend:scan-complete", {
            profileId: profile.id,
            profileName: profile.name,
            success: true,
            totalVideos: result.totalVideos,
            hotNew: result.hotNew,
            bySource: result.bySource,
          });
        }
      } catch (err) {
        // Special case: ProfileAlreadyScanningError means a manual scan is in progress.
        // Skip this profile WITHOUT recording an attempt (don't mess with its timing).
        if (err instanceof ProfileAlreadyScanningError || err.name === "ProfileAlreadyScanningError") {
          log(`[Scheduler] Skipping ${profile.name}: ${err.message}`);
          // Do NOT record attempt - let the in-flight scan handle timing
          continue;
        }

        log(`[Scheduler] Error scanning ${profile.name}: ${err.message}`);

        // Record scan attempt on failure (including timeout) so we don't retry every 5 minutes.
        // Profile waits its normal interval before next attempt.
        recordScanAttempt(profile.id);

        // Notify renderer of failure (without leaking apiKey)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("trend:scan-complete", {
            profileId: profile.id,
            profileName: profile.name,
            success: false,
            error: err.message,
          });
        }
      }
    }
  } catch (err) {
    // Catch-all: errors must never escape the interval callback
    log(`[Scheduler] Tick error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the background scheduler.
 * Runs an initial check after ~30s delay, then every 5 minutes.
 *
 * @param {object} options
 * @param {string} options.gpmHost - GPM host address
 * @param {function} options.log - Log function (default: console.log)
 * @param {function} options.onScanComplete - Callback when scan completes
 * @param {BrowserWindow} options.mainWindow - Main Electron window for IPC
 * @param {function} options.runScanFn - Injected runScan function (for testing, default: runScan from trend-research.js)
 * @param {number} options.scanTimeoutMs - Timeout per scan in ms (for testing, default: 15 min)
 */
export function startScheduler({
  gpmHost,
  log = console.log,
  onScanComplete,
  mainWindow,
  runScanFn = defaultRunScan,
  scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
} = {}) {
  if (intervalId || startupTimerId) {
    log("[Scheduler] Already running");
    return;
  }

  log("[Scheduler] Starting, initial check in 30s, then every 5 minutes");

  const tickOptions = { gpmHost, log, onScanComplete, mainWindow, runScanFn, scanTimeoutMs };

  // Initial check after 30 seconds (don't block app startup)
  startupTimerId = setTimeout(() => {
    startupTimerId = null;
    runTick(tickOptions);
  }, STARTUP_DELAY_MS);

  // Optionally unref so this timer doesn't keep Node alive during shutdown
  if (startupTimerId.unref) {
    startupTimerId.unref();
  }

  // Regular interval every 5 minutes
  intervalId = setInterval(() => {
    runTick(tickOptions);
  }, CHECK_INTERVAL_MS);

  // Optionally unref so this interval doesn't keep Node alive during shutdown
  if (intervalId.unref) {
    intervalId.unref();
  }
}

/**
 * Stop the background scheduler.
 * Should be called on app quit.
 */
export function stopScheduler() {
  if (startupTimerId) {
    clearTimeout(startupTimerId);
    startupTimerId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
}

/**
 * Check if scheduler is currently running.
 * @returns {boolean}
 */
export function isSchedulerRunning() {
  return intervalId !== null || startupTimerId !== null;
}

/**
 * Check if a tick is currently in progress (for testing re-entrancy).
 * @returns {boolean}
 */
export function isTickRunning() {
  return isRunning;
}

// Export for testing - allows tests to call runTick directly with injected deps
export { runTick as _runTickForTest };
