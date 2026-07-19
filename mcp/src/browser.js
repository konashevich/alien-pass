/**
 * Browser automation for local sign-in (Playwright + system Chrome/Chromium).
 *
 * Modes:
 * - Launch local Chrome (default) and navigate to URL
 * - Connect to an existing browser via CDP:
 *     ALIENPASS_CDP_URL=http://127.0.0.1:9222
 *     or ALIENPASS_CDP_PORT=9222
 *
 * Secrets stay in this process; callers should not log passwords.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

function cdpEndpoint() {
  if (process.env.ALIENPASS_CDP_URL) return process.env.ALIENPASS_CDP_URL;
  if (process.env.ALIENPASS_CDP_PORT) {
    return `http://127.0.0.1:${process.env.ALIENPASS_CDP_PORT}`;
  }
  return null;
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

async function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch (error) {
    throw Object.assign(
      new Error(
        'playwright-core is required for browser sign-in. Run: cd mcp && npm install'
      ),
      { code: 'playwright_missing', cause: error }
    );
  }
}

async function openContext(playwright, options = {}) {
  const endpoint = options.cdpUrl || cdpEndpoint();
  if (endpoint) {
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    return {
      browser,
      context,
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
  if (successSelector) {
    try {
      await page.locator(successSelector).first().waitFor({
        state: 'visible',
        timeout: options.timeout || 10000
      });
      return { ok: true, evidence: `selector:${successSelector}` };
    } catch {
      return { ok: false, evidence: 'success_selector_not_found' };
    }
  }
  if (successUrlIncludes) {
    const href = page.url();
    if (href.includes(successUrlIncludes)) {
      return { ok: true, evidence: `url_includes:${successUrlIncludes}` };
    }
    try {
      await page.waitForURL((url) => url.href.includes(successUrlIncludes), {
        timeout: options.timeout || 10000
      });
      return { ok: true, evidence: `url_includes:${successUrlIncludes}` };
    } catch {
      return { ok: false, evidence: `url_missing:${successUrlIncludes}`, url: page.url() };
    }
  }

  // Heuristic: password field gone or URL changed away from login-ish path
  const href = page.url();
  const passwordVisible = await page
    .locator(DEFAULT_PASS_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);
  if (!passwordVisible && !/login|signin|sign-in|auth/i.test(href)) {
    return { ok: true, evidence: 'password_field_gone_and_url_not_loginish' };
  }
  if (!passwordVisible) {
    return { ok: true, evidence: 'password_field_gone' };
  }
  return { ok: false, evidence: 'login_form_still_present', url: href };
}

/**
 * Sign in on a page: navigate (optional), fill username/password, submit, detect result.
 */
async function signInSession(options = {}) {
  const started = Date.now();
  const playwright = await loadPlaywright();
  const timeout = options.timeout_ms || Number(process.env.ALIENPASS_BROWSER_TIMEOUT_MS) || 20000;
  const session = await openContext(playwright, options);

  try {
    const targetUrl = options.url ? normalizeUrl(options.url) : null;
    if (targetUrl) {
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
    }

    const userSelector = options.username_selector || DEFAULT_USER_SELECTOR;
    const passSelector = options.password_selector || DEFAULT_PASS_SELECTOR;
    const submitSelector = options.submit_selector || DEFAULT_SUBMIT_SELECTOR;

    await fillSelector(session.page, userSelector, options.username, timeout);

    // Some IdPs are multi-step: username → next → password
    if (options.click_next_selector) {
      await maybeClick(session.page, options.click_next_selector, timeout);
      await session.page.waitForTimeout(400);
    } else {
      // Best-effort: if password not visible yet, try a generic Next
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
      evidence: detection.evidence,
      url: session.page.url(),
      via: session.via,
      submitted,
      duration_ms: Date.now() - started,
      error_code: detection.ok ? null : detection.evidence
    };
  } catch (error) {
    return {
      ok: false,
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

/**
 * Fill credentials on an already-open CDP page without navigation.
 */
async function fillCurrentPage(options = {}) {
  const started = Date.now();
  const playwright = await loadPlaywright();
  const timeout = options.timeout_ms || Number(process.env.ALIENPASS_BROWSER_TIMEOUT_MS) || 20000;
  const endpoint = options.cdpUrl || cdpEndpoint();
  if (!endpoint) {
    return {
      ok: false,
      error_code: 'cdp_required',
      evidence: 'Set ALIENPASS_CDP_URL/PORT for fill-without-navigation, or use sign_in_session',
      duration_ms: Date.now() - started
    };
  }

  const session = await openContext(playwright, options);
  try {
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
      evidence: options.submit ? 'filled_and_submitted' : 'filled_credentials',
      url: session.page.url(),
      via: session.via,
      duration_ms: Date.now() - started
    };
  } catch (error) {
    return {
      ok: false,
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
  DEFAULT_USER_SELECTOR,
  DEFAULT_PASS_SELECTOR,
  DEFAULT_SUBMIT_SELECTOR
};
