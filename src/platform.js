'use strict';

/**
 * Platform layer: the ONLY file that talks to the YouTube Playables SDK (ytgame).
 *
 * Rules this file enforces (from the Playables certification requirements):
 *  - firstFrameReady() before gameReady(); gameReady() only when interactive.
 *  - loadData() is awaited before saveData() is ever called.
 *  - Progress is saved ONLY with saveData() inside Playables (no cookies/localStorage there).
 *  - Audio follows isAudioEnabled() / onAudioEnabledChange().
 *  - Pause/resume use onPause()/onResume() only (no Page Visibility API inside Playables).
 *  - No other network requests are made by the game.
 *
 * Outside YouTube (local testing) every call falls back to harmless behaviour.
 */
const Platform = (() => {
  const LOCAL_KEY = 'tdhr_save_v1';
  const SAVE_VERSION = 1;

  const sdk = () =>
    (typeof ytgame !== 'undefined' && ytgame && ytgame.IN_PLAYABLES_ENV) ? ytgame : null;

  const inPlayables = () => !!sdk();

  /* ------------------------------------------------------------ save data */

  function defaults() {
    return { v: SAVE_VERSION, best: 0, bestDist: 0, coins: 0, runs: 0 };
  }

  function clampInt(n, max) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max);
  }

  /** Accepts anything (empty string, old versions, corrupted JSON) and returns a valid save. */
  function sanitize(raw) {
    const out = defaults();
    if (typeof raw !== 'string' || raw.length === 0) return out;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return out;
      out.best = clampInt(o.best, 1e9);
      out.bestDist = clampInt(o.bestDist, 1e9);
      out.coins = clampInt(o.coins, 1e9);
      out.runs = clampInt(o.runs, 1e9);
    } catch (e) { /* corrupted save -> start fresh, never crash */ }
    return out;
  }

  let loadPromise = null;
  let retryLoadPromise = null;
  let loadedOk = false;

  async function doLoad() {
    const s = sdk();
    try {
      let str = '';
      if (s) {
        str = await s.game.loadData();
      } else {
        try { str = window.localStorage.getItem(LOCAL_KEY) || ''; } catch (e) { str = ''; }
      }
      loadedOk = true;
      return sanitize(str);
    } catch (e) {
      loadedOk = false;
      warn();
      return defaults();
    }
  }

  function loadSave() {
    if (!loadPromise) loadPromise = doLoad();
    return loadPromise;
  }

  /**
   * Wait for the original load request before retrying. The boot screen may time out
   * visually while loadData() is still pending; starting a second load at that point
   * can race the first request. A shared retry promise also prevents simultaneous
   * save requests from launching duplicate retries after a failed load.
   */
  async function ensureLoadedForSave() {
    if (loadedOk) return null;

    if (!loadPromise) loadPromise = doLoad();
    let cloud = await loadPromise;
    if (loadedOk) return cloud;

    if (!retryLoadPromise) {
      retryLoadPromise = doLoad().finally(() => {
        retryLoadPromise = null;
      });
    }
    cloud = await retryLoadPromise;
    return loadedOk ? cloud : null;
  }

  /**
   * Persist progress. A successful loadData() must precede saveData(). If the first
   * load failed, retry once for this save attempt and merge so better cloud progress
   * is never overwritten. If the load is still unavailable, skip this save.
   */
  async function saveProgress(save) {
    try {
      if (!loadedOk) {
        const cloud = await ensureLoadedForSave();
        if (!loadedOk || !cloud) return false;
        save.best = Math.max(save.best, cloud.best);
        save.bestDist = Math.max(save.bestDist, cloud.bestDist);
        save.coins = Math.max(save.coins, cloud.coins);
        save.runs = Math.max(save.runs, cloud.runs);
      }
      const str = JSON.stringify({
        v: SAVE_VERSION, best: save.best, bestDist: save.bestDist,
        coins: save.coins, runs: save.runs
      });
      const s = sdk();
      if (s) {
        await s.game.saveData(str);
      } else {
        try { window.localStorage.setItem(LOCAL_KEY, str); } catch (e) { /* ignore */ }
      }
      return true;
    } catch (e) {
      warn();
      return false;
    }
  }

  /* ---------------------------------------------------------- engagement */

  function sendScore(value) {
    const s = sdk();
    if (!s) return;
    try {
      const v = Math.max(0, Math.floor(value));
      const p = s.engagement.sendScore({ value: v });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* best effort */ }
  }

  /* ----------------------------------------------------------- lifecycle */

  let firstSent = false;
  let readySent = false;

  function firstFrameReady() {
    if (firstSent) return;
    firstSent = true;
    const s = sdk();
    if (s) { try { s.game.firstFrameReady(); } catch (e) { /* ignore */ } }
  }

  function gameReady() {
    if (readySent) return;
    if (!firstSent) firstFrameReady();       // SDK requires first-frame before ready
    readySent = true;
    const s = sdk();
    if (s) { try { s.game.gameReady(); } catch (e) { /* ignore */ } }
  }

  /* --------------------------------------------------------------- audio */

  function isAudioEnabled() {
    const s = sdk();
    if (!s) return true;
    try { return !!s.system.isAudioEnabled(); } catch (e) { return true; }
  }

  function onAudioEnabledChange(cb) {
    const s = sdk();
    if (s) { try { s.system.onAudioEnabledChange(cb); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------ pause / resume */

  function onPauseResume(onPause, onResume) {
    const s = sdk();
    if (!s) return;               // outside YouTube there is nothing to listen to (local testing only)
    try {
      s.system.onPause(onPause);
      s.system.onResume(onResume);
    } catch (e) { /* ignore */ }
  }

  /* -------------------------------------------------------------- health */

  function warn() {
    const s = sdk();
    if (s) { try { s.health.logWarning(); } catch (e) { /* ignore */ } }
  }

  function error() {
    const s = sdk();
    if (s) { try { s.health.logError(); } catch (e) { /* ignore */ } }
  }

  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', error);

  return {
    inPlayables, loadSave, saveProgress, sendScore,
    firstFrameReady, gameReady,
    isAudioEnabled, onAudioEnabledChange, onPauseResume,
    warn, error, defaults
  };
})();
