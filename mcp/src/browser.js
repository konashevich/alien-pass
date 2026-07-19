/**
 * Browser automation for local sign-in (Playwright + system Chrome/Chromium).
 *
 * Modes:
 * - Launch local Chrome (default) and navigate to URL
 * - Connect to an existing browser via CDP:
 *     ALIENPASS_CDP_URL=http://127.0.0.1:9222
 *     or ALIENPASS_CDP_PORT=9222
 *
 * CDP endpoints must be loopback unless ALIENPASS_ALLOW_REMOTE_CDP=1.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeHostname } = require('./credentials');

const DEFAULT_USER_SELECTOR =
  'input[type="email"], input[name="username"], input[name="email"], input[autocomplete="username"], input#username, input#email';
const DEFAULT_PASS_SELECTOR =
  'input[type="password"], input[name="password"], input[autocomplete="current-password"], input#password';
const DEFAULT_SUBMIT_SELECTOR =
  'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';

function resolveChromePath() {
  if (process.env.ALIENPASS_CHROME_PATH) return process.env.ALIENPASS_CHROME_PATH;
  const candidates = [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function assertLoopbackCdp(endpoint) {
  if (process.env.ALIENPASS_ALLOW_REMOTE_CDP === '1') return;
  let hostname;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw Object.assign(new Error('invalid_cdp_url'), { code: 'invalid_cdp_url' });
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw Object.assign(
      new Error('CDP URL must be loopback (127.0.0.1/localhost). Set ALIENPASS_ALLOW_REMOTE_CDP=1 to override.'),
      { code: 'cdp_not_loopback' }
    );
  }
}

function cdpEndpoint() {
  let endpoint = null;
  if (process.env.ALIENPASS_CDP_URL) endpoint = process.env.ALIENPASS_CDP_URL;
  else if (process.env.ALIENPASS_CDP_PORT) {
    endpoint = `http://127.0.0.1:${process.env.ALIENPASS_CDP_PORT}`;
  }
  if (endpoint) assertLoopbackCdp(endpoint);
  return endpoint;
}

function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) throw Object.assign(new Error('url_required'), { code: 'url_required' });
  if (raw.startsWith('file:')) return raw;

  const qIndex = raw.search(/[?#]/);
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const suffix = qIndex >= 0 ? raw.slice(qIndex) : '';

  if (path.isAbsolute(pathPart) && fs.existsSync(pathPart)) {
    return pathToFileURL(pathPart).href + suffix;
  }
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('file:')) {
    return `https://${raw}`;
  }
  return raw;
}

function hostOf(url) {
  try {
    if (String(url).startsWith('file:')) return 'file';
    return normalizeHostname(url);
  } catch {
    return null;
  }
}

function hostsMatch(expected, actual) {
  if (!expected || !actual) return false;
  if (expected === 'file' && actual === 'file') return true;
  if (actual === expected) return true;
  return actual.endsWith(`.${expected}`) || expected.endsWith(`.${actual}`);
}

async function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch (error) {
    throw Object.assign(
      new Error('playwright-core is required for browser sign-in. Run: cd mcp && npm install'),
      { code: 'playwright_missing', cause: error }
    );
  }
}

async function collectPages(browser) {
  const pages = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) pages.push({ context, page });
  }
  return pages;
}

async function pickTargetPage(browser, options = {}) {
  const expectedHost = options.expectedHost || (options.url ? hostOf(options.url) : null);
  const pages = await collectPages(browser);

  if (expectedHost) {
    const matching = [];
    for (const entry of pages) {
      const pageHost = hostOf(entry.page.url());
      if (hostsMatch(expectedHost, pageHost)) matching.push(entry);
    }

    if (matching.length === 1) return matching[0].page;

    if (matching.length > 1) {
      for (const entry of matching) {
        const visible = await entry.page
          .locator(DEFAULT_PASS_SELECTOR)
          .first()
          .isVisible()
          .catch(() => false);
        if (visible) return entry.page;
      }
      throw Object.assign(
        new Error(`ambiguous_cdp_target:${expectedHost}:${matching.length}_tabs`),
        { code: 'ambiguous_cdp_target' }
      );
    }
  }

  // No host match: prefer a page that already shows a password field.
  for (const entry of pages) {
    const visible = await entry.page
      .locator(DEFAULT_PASS_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) {
      if (expectedHost) {
        throw Object.assign(
          new Error(`cdp_host_mismatch:expected_${expectedHost}_got_${hostOf(entry.page.url())}`),
          { code: 'cdp_host_mismatch' }
        );
      }
      return entry.page;
    }
  }

  if (options.url) {
    const context = browser.contexts()[0] || (await browser.newContext());
    return context.newPage();
  }

  throw Object.assign(new Error('cdp_no_matching_page'), { code: 'cdp_no_matching_page' });
}

async function openContext(playwright, options = {}) {
  const endpoint = options.cdpUrl || cdpEndpoint();
  if (endpoint) {
    assertLoopbackCdp(endpoint);
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    const page = await pickTargetPage(browser, options);
    return {
      browser,
      context: page.context(),
      page,
      owned: false,
      via: 'cdp',
      endpoint
    };
  }

  const executablePath = options.executablePath || resolveChromePath();
  const headless =
    options.headless != null
      ? Boolean(options.headless)
      : process.env.ALIENPASS_BROWSER_HEADLESS !== '0';

  const launchOptions = {
    headless,
    args: ['--disable-dev-shm-usage', '--no-default-browser-check']
  };
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await playwright.chromium.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    owned: true,
    via: 'launch',
    executablePath: executablePath || 'bundled-not-used'
  };
}

async function fillSelector(page, selector, value, timeout) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout });
  await locator.fill('');
  await locator.fill(String(value));
}

async function maybeClick(page, selector, timeout) {
  if (!selector) return false;
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 5000) });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

async function detectSuccess(page, options = {}) {
  const successSelector = options.success_selector;
  const successUrlIncludes = options.success_url_includes;
  const timeout = options.timeout || 10000;

  if (successSelector) {
    try {
      await page.locator(successSelector).first().waitFor({ state: 'visible', timeout });
      return { ok: true, verified: true, evidence: `selector:${successSelector}` };
    } catch {
      return {
        ok: false,
        verified: false,
        evidence: 'success_selector_not_found',
        error_code: 'success_selector_not_found'
      };
    }
  }

  if (successUrlIncludes) {
    try {
      if (page.url().includes(successUrlIncludes)) {
        return { ok: true, verified: true, evidence: `url_includes:${successUrlIncludes}` };
      }
      await page.waitForURL((url) => url.href.includes(successUrlIncludes), { timeout });
      return { ok: true, verified: true, evidence: `url_includes:${successUrlIncludes}` };
    } catch {
      return {
        ok: false,
        verified: false,
        evidence: `url_missing:${successUrlIncludes}`,
        error_code: 'success_url_missing',
        url: page.url()
      };
    }
  }

  // Without explicit success criteria, do not claim authentication success.
  const href = page.url();
  const passwordVisible = await page
    .locator(DEFAULT_PASS_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);

  if (/challenge|otp|2fa|mfa|verify|captcha/i.test(href) || passwordVisible === false) {
    return {
      ok: false,
      verified: false,
      evidence: 'submitted_unverified',
      error_code: 'unverified'
    };
  }

  return {
    ok: false,
    verified: false,
    evidence: 'login_form_still_present',
    error_code: 'login_form_still_present',
    url: href
  };
}

async function signInSession(options = {}) {
  const started = Date.now();
  const playwright = await loadPlaywright();
  const timeout = options.timeout_ms || Number(process.env.ALIENPASS_BROWSER_TIMEOUT_MS) || 20000;
  let session;
  try {
    session = await openContext(playwright, {
      ...options,
      expectedHost: options.expectedHost || (options.url ? hostOf(options.url) : null)
    });
  } catch (error) {
    return {
      ok: false,
      verified: false,
      evidence: error.message,
      error_code: error.code || 'browser_open_failed',
      url: null,
      via: null,
      duration_ms: Date.now() - started
    };
  }

  try {
    const targetUrl = options.url ? normalizeUrl(options.url) : null;
    if (targetUrl) {
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
    }

    const userSelector = options.username_selector || DEFAULT_USER_SELECTOR;
    const passSelector = options.password_selector || DEFAULT_PASS_SELECTOR;
    const submitSelector = options.submit_selector || DEFAULT_SUBMIT_SELECTOR;

    await fillSelector(session.page, userSelector, options.username, timeout);

    if (options.click_next_selector) {
      await maybeClick(session.page, options.click_next_selector, timeout);
      await session.page.waitForTimeout(400);
    } else {
      const passVisible = await session.page
        .locator(passSelector)
        .first()
        .isVisible()
        .catch(() => false);
      if (!passVisible) {
        await maybeClick(
          session.page,
          'button:has-text("Next"), button:has-text("Continue"), #identifierNext',
          timeout
        );
        await session.page.waitForTimeout(500);
      }
    }

    await fillSelector(session.page, passSelector, options.password, timeout);

    const submitted = await maybeClick(session.page, submitSelector, timeout);
    if (!submitted) {
      await session.page.locator(passSelector).first().press('Enter');
    }

    await session.page.waitForTimeout(800);
    const detection = await detectSuccess(session.page, {
      success_selector: options.success_selector,
      success_url_includes: options.success_url_includes,
      timeout
    });

    return {
      ok: detection.ok,
      verified: Boolean(detection.verified),
      evidence: detection.evidence,
      url: session.page.url(),
      via: session.via,
      submitted,
      duration_ms: Date.now() - started,
      error_code: detection.ok ? null : detection.error_code || detection.evidence
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      evidence: error.message,
      error_code: error.code || 'browser_signin_failed',
      url: session.page ? session.page.url() : null,
      via: session.via,
      duration_ms: Date.now() - started
    };
  } finally {
    if (session.owned) {
      await session.browser.close().catch(() => {});
    }
  }
}

async function fillCurrentPage(options = {}) {
  const started = Date.now();
  const playwright = await loadPlaywright();
  const timeout = options.timeout_ms || Number(process.env.ALIENPASS_BROWSER_TIMEOUT_MS) || 20000;
  const endpoint = options.cdpUrl || cdpEndpoint();
  if (!endpoint) {
    return {
      ok: false,
      verified: false,
      error_code: 'cdp_required',
      evidence: 'Set ALIENPASS_CDP_URL/PORT for fill-without-navigation, or use sign_in_session',
      duration_ms: Date.now() - started
    };
  }

  let session;
  try {
    session = await openContext(playwright, {
      ...options,
      expectedHost: options.expectedHost || (options.site ? hostOf(options.site) : null)
    });
  } catch (error) {
    return {
      ok: false,
      verified: false,
      error_code: error.code || 'browser_open_failed',
      evidence: error.message,
      duration_ms: Date.now() - started
    };
  }

  try {
    const expectedHost = options.expectedHost || (options.site ? hostOf(options.site) : null);
    const pageHost = hostOf(session.page.url());
    if (expectedHost && pageHost && !hostsMatch(expectedHost, pageHost)) {
      return {
        ok: false,
        verified: false,
        error_code: 'cdp_host_mismatch',
        evidence: `expected_${expectedHost}_got_${pageHost}`,
        url: session.page.url(),
        via: session.via,
        duration_ms: Date.now() - started
      };
    }

    const userSelector = options.username_selector || DEFAULT_USER_SELECTOR;
    const passSelector = options.password_selector || DEFAULT_PASS_SELECTOR;
    await fillSelector(session.page, userSelector, options.username, timeout);
    await fillSelector(session.page, passSelector, options.password, timeout);
    if (options.submit) {
      const submitSelector = options.submit_selector || DEFAULT_SUBMIT_SELECTOR;
      const submitted = await maybeClick(session.page, submitSelector, timeout);
      if (!submitted) await session.page.locator(passSelector).first().press('Enter');
    }
    return {
      ok: true,
      verified: false,
      evidence: options.submit ? 'filled_and_submitted_unverified' : 'filled_credentials',
      url: session.page.url(),
      via: session.via,
      duration_ms: Date.now() - started
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      error_code: error.code || 'fill_failed',
      evidence: error.message,
      url: session.page ? session.page.url() : null,
      via: session.via,
      duration_ms: Date.now() - started
    };
  } finally {
    if (session.owned) {
      await session.browser.close().catch(() => {});
    }
  }
}

module.exports = {
  signInSession,
  fillCurrentPage,
  resolveChromePath,
  cdpEndpoint,
  normalizeUrl,
  hostOf,
  hostsMatch,
  DEFAULT_USER_SELECTOR,
  DEFAULT_PASS_SELECTOR,
  DEFAULT_SUBMIT_SELECTOR
};
