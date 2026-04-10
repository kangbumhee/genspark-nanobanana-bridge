const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 8787);
const BRIDGE_API_KEY = String(process.env.BRIDGE_API_KEY || '').trim();
const GENSPARK_USER_DATA_DIR = path.resolve(
  process.cwd(),
  process.env.GENSPARK_USER_DATA_DIR || './playwright-user-data'
);
const GENSPARK_HEADLESS = String(process.env.GENSPARK_HEADLESS || 'false') === 'true';
const GENSPARK_AI_IMAGE_URL = 'https://www.genspark.ai/ai_image';
const BROWSER_IDLE_MS = Number(process.env.BROWSER_IDLE_MS || 180000);

let contextPromise = null;
let browserIdleTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearBrowserIdleTimer() {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
}

async function closeContext() {
  clearBrowserIdleTimer();
  if (!contextPromise) return;

  try {
    const context = await contextPromise;
    await context.close();
  } catch (_) {
  } finally {
    contextPromise = null;
  }
}

function scheduleBrowserClose() {
  clearBrowserIdleTimer();
  browserIdleTimer = setTimeout(() => {
    closeContext().catch(() => {});
  }, BROWSER_IDLE_MS);
}

function requireApiKey(req, res, next) {
  if (!BRIDGE_API_KEY) {
    res.status(503).json({ success: false, error: 'BRIDGE_API_KEY is not configured' });
    return;
  }

  const header = String(req.headers['x-bridge-api-key'] || '').trim();
  if (header !== BRIDGE_API_KEY) {
    res.status(401).json({ success: false, error: 'Invalid bridge API key' });
    return;
  }

  next();
}

async function getContext({ headless = GENSPARK_HEADLESS } = {}) {
  if (!contextPromise) {
    contextPromise = chromium.launchPersistentContext(GENSPARK_USER_DATA_DIR, {
      headless,
      channel: 'chrome',
      viewport: { width: 1440, height: 960 }
    });
  }

  const context = await contextPromise;
  scheduleBrowserClose();
  return context;
}

async function getPage(context) {
  const existing = context.pages()[0];
  const page = existing || (await context.newPage());
  await page.goto(GENSPARK_AI_IMAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  scheduleBrowserClose();
  return page;
}

async function waitForLoginReady(page) {
  await page.waitForFunction(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const hasLogin = text.includes('로그인 또는 회원가입') || text.includes('Google로 계속하기');
    return !hasLogin && !!document.querySelector('textarea');
  }, null, { timeout: 60000 });
}

async function uploadReferenceImage(page, imageData, imageName) {
  if (!imageData) return;

  const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  const inputHandle = await page.locator('input[type="file"]').last().elementHandle().catch(() => null);

  if (inputHandle) {
    await inputHandle.setInputFiles({
      name: imageName || 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64')
    });
    await sleep(1500);
    return;
  }

  const addEntry = page.locator('.add-entry-btn, [class*="add-entry"]').first();
  if (await addEntry.count()) {
    await addEntry.click().catch(() => {});
    await sleep(800);
  }

  const fileInput = page.locator('input[type="file"]').last();
  await fileInput.setInputFiles({
    name: imageName || 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64')
  });
  await sleep(1500);
}

async function submitPrompt(page, prompt) {
  const textarea = page.locator('textarea.search-input.j-search-input, textarea').first();
  await textarea.waitFor({ timeout: 30000 });
  await textarea.fill(prompt);
  await sleep(400);

  const submit = page.locator('.enter-icon-wrapper, button[type="submit"], button[class*="send"]').first();
  await submit.click();
}

async function waitForImages(page) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const urls = await page.evaluate(() => {
      return [...document.querySelectorAll('img')]
        .filter((img) => {
          const rect = img.getBoundingClientRect();
          return rect.width > 150 && rect.height > 150;
        })
        .map((img) => img.src)
        .filter((src) => src && (src.includes('/api/files/') || src.startsWith('blob:')));
    });

    if (urls.length > 0) {
      return [...new Set(urls)];
    }

    await sleep(3000);
  }

  throw new Error('Image generation timed out');
}

async function openLoginWindow() {
  const context = await chromium.launchPersistentContext(GENSPARK_USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 960 }
  });
  const page = await getPage(context);
  await page.bringToFront();
  console.log('Login browser opened. Sign in to Genspark, then close the browser window.');
  context.on('close', () => process.exit(0));
}

async function start() {
  if (process.argv.includes('--login')) {
    await openLoginWindow();
    return;
  }

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/healthz', async (req, res) => {
    res.json({
      success: true,
      service: 'genspark-bridge',
      browserActive: !!contextPromise
    });
  });

  app.get('/auth-status', async (req, res) => {
    try {
      const context = await getContext();
      const page = await getPage(context);
      const loggedIn = await page.evaluate(() => {
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
        return !text.includes('로그인 또는 회원가입');
      });
      res.json({
        success: true,
        service: 'genspark-bridge',
        loggedIn
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error.message || error) });
    }
  });

  app.post('/api/generate-image', requireApiKey, async (req, res) => {
    try {
      const { prompt, imageData, imageName } = req.body || {};
      if (!prompt) {
        res.status(400).json({ success: false, error: 'prompt is required' });
        return;
      }

      const context = await getContext();
      const page = await getPage(context);
      await waitForLoginReady(page);
      await uploadReferenceImage(page, imageData, imageName);
      await submitPrompt(page, prompt);
      const images = await waitForImages(page);

      res.json({
        success: true,
        images,
        elapsed: null
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error.message || error) });
    }
  });

  app.listen(PORT, () => {
    console.log(`Bridge server listening on http://127.0.0.1:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
