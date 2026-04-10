/* ======================================================
   Service Worker — 나노바나나 무료 스튜디오
   Genspark 탭 관리 + 자동화 제어
   ====================================================== */

// ── 설치 시 초기화 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings', 'history', 'prompts'], (data) => {
    if (!data.settings) {
      chrome.storage.local.set({
        settings: {
          authCookies: '',
          defaultRatio: '1:1',
          defaultCount: '1',
          autoPromptEnhance: true
        }
      });
    }
    if (!data.history) chrome.storage.local.set({ history: [] });
    if (!data.prompts) chrome.storage.local.set({ prompts: [] });
  });
});

// ── 메시지 핸들러 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_AUTH_STATUS') {
    checkBridgeStatus()
      .then(status => sendResponse({ success: true, ...status }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GENERATE_IMAGE') {
    handleGenerateViaBridge(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_GENSPARK_TAB') {
    findOrCreateGensparkTab()
      .then(tab => sendResponse({ success: true, tabId: tab.id }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SET_COOKIES') {
    (message.cookieObjects
      ? setCookieObjects(message.cookieObjects)
      : setCookies(message.cookies))
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'INJECT_AND_RUN') {
    injectAndRun(message.tabId, message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

const REQUIRED_AUTH_COOKIES = ['ai_user'];
const SESSION_COOKIE_CANDIDATES = [
  'ai_session',
  'gslogin',
  '__Secure-next-auth.session-token',
  'next-auth.session-token'
];
const OPTIONAL_AUTH_COOKIES = ['gslogin', 'i18n_set'];
const COOKIE_ATTR_NAMES = new Set([
  'path', 'domain', 'expires', 'max-age', 'secure', 'httponly',
  'samesite', 'priority', 'partitioned'
]);
const GENSPARK_PRIMARY_ORIGIN = 'https://genspark.ai';
const GENSPARK_AI_IMAGE_URL = `${GENSPARK_PRIMARY_ORIGIN}/ai_image`;
const GENSPARK_IMAGE_CHAT_URL = `${GENSPARK_PRIMARY_ORIGIN}/agents?type=image_generation_agent&action=chat_now`;
const GENSPARK_URL_PATTERNS = [
  'https://genspark.ai/*',
  'https://www.genspark.ai/*'
];

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return settings;
}

function normalizeBridgeUrl(url) {
  const raw = String(url || '').trim() || 'http://127.0.0.1:8787';
  return raw.replace(/\/+$/, '');
}

async function fetchBridge(path, options = {}) {
  const settings = await getSettings();
  const bridgeUrl = normalizeBridgeUrl(settings.bridgeUrl);
  const headers = Object.assign({}, options.headers || {});

  if (settings.bridgeApiKey) {
    headers['x-bridge-api-key'] = settings.bridgeApiKey;
  }

  const response = await fetch(bridgeUrl + path, Object.assign({}, options, { headers }));
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { success: false, error: text || `HTTP ${response.status}` };
  }

  if (!response.ok || (data && data.success === false)) {
    throw new Error((data && data.error) || `Bridge request failed (${response.status})`);
  }

  return data;
}

async function checkBridgeStatus() {
  const settings = await getSettings();
  const bridgeUrl = normalizeBridgeUrl(settings.bridgeUrl);
  const health = await fetchBridge('/health');
  return {
    mode: 'bridge',
    bridgeUrl,
    authReady: !!health.loggedIn,
    bridgeConnected: true,
    loggedIn: !!health.loggedIn
  };
}

async function handleGenerateViaBridge(payload) {
  return fetchBridge('/api/generate-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
}

// ── Genspark 탭 찾기/생성 ──
async function findOrCreateGensparkTab() {
  const tabs = await chrome.tabs.query({ url: GENSPARK_URL_PATTERNS });

  const agentTab = tabs.find(t => t.url && t.url.includes('/agents?type=image_generation_agent'));
  if (agentTab) {
    await chrome.tabs.update(agentTab.id, { active: true });
    return agentTab;
  }

  const imageTab = tabs.find(t => t.url && t.url.includes('/ai_image'));
  if (imageTab) {
    await chrome.tabs.update(imageTab.id, { active: true });
    return imageTab;
  }

  if (tabs.length > 0) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    return t;
  }

  const tab = await chrome.tabs.create({
    url: GENSPARK_AI_IMAGE_URL,
    active: false
  });

  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  return tab;
}

// ── 쿠키 설정 ──
async function setCookies(cookieString) {
  const cookies = parseCookieString(cookieString);

  for (const cookie of cookies) {
    try {
      await chrome.cookies.set({
        url: GENSPARK_PRIMARY_ORIGIN,
        name: cookie.name,
        value: cookie.value,
        domain: '.genspark.ai',
        path: '/',
        secure: true,
        sameSite: 'lax'
      });
    } catch (e) {
      console.warn('쿠키 설정 실패:', cookie.name, e.message);
    }
  }
}

async function setCookieObjects(cookieObjects) {
  if (!Array.isArray(cookieObjects) || cookieObjects.length === 0) return;

  for (const c of cookieObjects) {
    if (!c || !c.name || typeof c.value === 'undefined') continue;

    const domain = (c.domain || '.genspark.ai').toLowerCase();
    if (!domain.includes('genspark.ai')) continue;

    const cookieHost = String(c.domain || 'genspark.ai').replace(/^\./, '');
    const details = {
      url: `${c.secure ? 'https' : 'http'}://${cookieHost}`,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: typeof c.secure === 'boolean' ? c.secure : true,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite || 'lax'
    };

    if (c.domain && !c.hostOnly) details.domain = c.domain;
    if (typeof c.expirationDate === 'number' && Number.isFinite(c.expirationDate)) {
      details.expirationDate = c.expirationDate;
    }

    try {
      await chrome.cookies.set(details);
    } catch (e) {
      console.warn('쿠키 객체 설정 실패:', c.name, e.message);
    }
  }
}

function parseCookieString(str) {
  if (!str || typeof str !== 'string') return [];

  return str
    .split(';')
    .map(pair => {
      const [name, ...rest] = pair.trim().split('=');
      return { name: (name || '').trim(), value: rest.join('=').trim() };
    })
    .filter(c => c.name && c.value && !COOKIE_ATTR_NAMES.has(c.name.toLowerCase()));
}

async function getAuthCookieState() {
  const allCookies = await chrome.cookies.getAll({});
  const all = allCookies.filter(c => String(c.domain || '').includes('genspark.ai'));
  const names = new Set(all.map(c => c.name));
  const missing = REQUIRED_AUTH_COOKIES.filter(name => !names.has(name));
  const hasSessionCookie = SESSION_COOKIE_CANDIDATES.some(name => names.has(name));
  const optionalFound = OPTIONAL_AUTH_COOKIES.filter(name => names.has(name));
  return {
    ready: missing.length === 0 && hasSessionCookie,
    missing,
    hasSessionCookie,
    foundCount: REQUIRED_AUTH_COOKIES.length - missing.length,
    optionalFound
  };
}

async function ensureAuthCookiesFromSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const objects = Array.isArray(settings.authCookieObjects) ? settings.authCookieObjects : [];
  const saved = (settings.authCookies || '').trim();

  let applied = false;
  if (objects.length > 0) {
    await setCookieObjects(objects);
    applied = true;
  }
  if (saved) {
    await setCookies(saved);
    applied = true;
  }

  if (applied) await new Promise(r => setTimeout(r, 350));
  return applied;
}

async function checkAuthStatus() {
  const tab = await findOrCreateGensparkTab();

  let state = await getAuthCookieState();
  if (!state.ready) {
    await ensureAuthCookiesFromSettings();
    state = await getAuthCookieState();
  }

  return {
    tabId: tab.id,
    authReady: state.ready,
    missingCookies: state.missing,
    hasSessionCookie: state.hasSessionCookie,
    optionalCookies: state.optionalFound
  };
}

async function waitTabComplete(tabId, timeoutMs = 20000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current && current.status === 'complete') return;

  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('탭 로딩 시간 초과'));
    }, timeoutMs);

    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function prepareAuthenticatedImageTab() {
  const tab = await findOrCreateGensparkTab();
  await ensureAuthCookiesFromSettings();

  const nextUrl = tab.url && tab.url.includes('/agents?type=image_generation_agent')
    ? GENSPARK_IMAGE_CHAT_URL
    : GENSPARK_AI_IMAGE_URL;

  await chrome.tabs.update(tab.id, { url: nextUrl });
  await waitTabComplete(tab.id);
  await new Promise(r => setTimeout(r, 1200));

  return tab;
}

// ── 탭에 스크립트 주입 및 실행 ──
async function injectAndRun(tabId, payload) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: automateGenspark,
    args: [payload]
  });

  return results[0]?.result;
}

// ── Genspark 자동화 함수 (탭 내에서 실행) ──
function automateGenspark(payload) {
  return new Promise(async (resolve, reject) => {
    try {
      const { prompt, imageData, imageName } = payload;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      const hasLoginOverlay = () => {
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
        return (
          bodyText.includes('로그인 또는 회원가입') ||
          bodyText.includes('Google로 계속하기') ||
          bodyText.includes('회원가입')
        );
      };

      const findPromptTextarea = () => {
        const selectors = [
          'textarea.search-input.j-search-input',
          'textarea[placeholder]',
          'textarea'
        ];
        return selectors.map(sel => document.querySelector(sel)).find(Boolean) || null;
      };

      const findSubmitButton = () => {
        const selectors = [
          '.enter-icon-wrapper',
          'button[type="submit"]',
          'button[class*="send"]',
          'button[class*="enter"]'
        ];
        return selectors.map(sel => document.querySelector(sel)).find(Boolean) || null;
      };

      const findFileInputs = () => {
        return [...document.querySelectorAll('input[type="file"]')]
          .filter(input => !input.disabled);
      };

      const assignFileToInput = (input, file) => {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      if (hasLoginOverlay()) {
        reject(new Error('Genspark 로그인 상태가 아닙니다. 설정에서 쿠키를 갱신해주세요.'));
        return;
      }

      if (imageData) {
        const byteString = atob(imageData.split(',')[1] || imageData);
        const mimeType = imageData.includes('data:')
          ? imageData.split(':')[1].split(';')[0]
          : 'image/png';
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeType });
        const file = new File([blob], imageName || 'product.png', { type: mimeType });
        let targetInput = findFileInputs().at(-1) || null;

        if (!targetInput) {
          const addButtons = [
            document.querySelector('.add-entry-btn'),
            document.querySelector('[class*="add-entry"]'),
            [...document.querySelectorAll('button, div, span')].find(el => {
              const text = (el.textContent || '').trim();
              return text.includes('로컬 파일') || text.includes('업로드');
            })
          ].filter(Boolean);

          for (const btn of addButtons) {
            btn.click();
            await sleep(800);
            targetInput = findFileInputs().at(-1) || null;
            if (targetInput) break;
          }
        }

        if (!targetInput) {
          reject(new Error('이미지 업로드 입력창을 찾지 못했습니다.'));
          return;
        }

        assignFileToInput(targetInput, file);
        await sleep(2000);
      }

      const textarea = findPromptTextarea();
      if (!textarea) {
        reject(new Error('입력창을 찾을 수 없습니다'));
        return;
      }

      textarea.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      setter.call(textarea, prompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      await sleep(500);

      const enterBtn = findSubmitButton();
      if (!enterBtn) {
        reject(new Error('전송 버튼을 찾을 수 없습니다'));
        return;
      }
      enterBtn.click();

      const startTime = Date.now();
      const maxWait = 180000;

      while (Date.now() - startTime < maxWait) {
        await sleep(3000);

        if (hasLoginOverlay()) {
          reject(new Error('세션이 만료되었습니다. 설정에서 쿠키를 다시 감지/저장하세요.'));
          return;
        }

        const imgs = [...document.querySelectorAll('img')].filter(img => {
          const r = img.getBoundingClientRect();
          return r.width > 150 && r.height > 150 &&
                 (
                   img.src.includes('/api/files/s/') ||
                   img.src.includes('/api/files/') ||
                   img.src.includes('blob:')
                 );
        });

        const loading = document.querySelector('[class*="generating"], [class*="loading"]');

        if (imgs.length > 0 && !loading && (Date.now() - startTime) > 10000) {
          const urls = [...new Set(imgs.map(img => img.src))];
          resolve({
            success: true,
            images: urls,
            elapsed: Math.round((Date.now() - startTime) / 1000)
          });
          return;
        }
      }

      reject(new Error('이미지 생성 시간 초과 (3분)'));
    } catch (e) {
      reject(e);
    }
  });
}

// ── 메인 생성 핸들러 ──
async function handleGenerate(payload) {
  await ensureAuthCookiesFromSettings();
  const auth = await getAuthCookieState();
  if (!auth.ready) {
    throw new Error('유효한 로그인 세션 쿠키를 찾지 못했습니다. 설정에서 자동 감지 후 저장한 뒤 다시 시도해주세요.');
  }

  const tab = await prepareAuthenticatedImageTab();

  const result = await injectAndRun(tab.id, payload);
  return result;
}
