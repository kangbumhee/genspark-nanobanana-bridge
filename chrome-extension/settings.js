function sendMessageAsync(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(res);
    });
  });
}

function hasRequiredCookieNames(cookieString) {
  const lower = (cookieString || '').toLowerCase();
  return lower.includes('ai_user=') && lower.includes('ai_session=');
}

document.addEventListener('DOMContentLoaded', async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  let detectedCookieObjects = Array.isArray(settings.authCookieObjects) ? settings.authCookieObjects : [];

  document.getElementById('bridge-url').value = settings.bridgeUrl || 'http://127.0.0.1:8787';
  document.getElementById('bridge-api-key').value = settings.bridgeApiKey || '';
  document.getElementById('auth-cookies').value = settings.authCookies || '';
  document.getElementById('default-ratio').value = settings.defaultRatio || '1:1';
  document.getElementById('default-count').value = settings.defaultCount || '1';

  document.getElementById('btn-auto-detect').addEventListener('click', async () => {
    try {
      const allCookies = await chrome.cookies.getAll({});
      const cookies = allCookies.filter(c => String(c.domain || '').includes('genspark.ai'));
      detectedCookieObjects = cookies;

      const important = cookies.filter(c =>
        ['ai_user', 'ai_session', 'gslogin', 'i18n_set'].includes(c.name)
      );
      const allCookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      document.getElementById('auth-cookies').value = allCookieStr;

      if (cookies.length > 0) {
        alert(
          `✅ 총 ${cookies.length}개 쿠키 감지됨!\n` +
          `핵심: ${important.map(c => c.name).join(', ') || '없음'}\n` +
          `전체: ${cookies.map(c => c.name).join(', ')}`
        );
      } else {
        alert('⚠️ Genspark 쿠키를 찾을 수 없습니다.\nGenspark에 로그인 후 다시 시도하세요.');
      }
    } catch (e) {
      alert('쿠키 감지 실패: ' + e.message);
    }
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const rawCookieText = document.getElementById('auth-cookies').value.trim();
    const newSettings = {
      bridgeUrl: document.getElementById('bridge-url').value.trim(),
      bridgeApiKey: document.getElementById('bridge-api-key').value.trim(),
      authCookies: rawCookieText,
      authCookieObjects: detectedCookieObjects,
      defaultRatio: document.getElementById('default-ratio').value,
      defaultCount: document.getElementById('default-count').value,
    };

    if (!newSettings.bridgeUrl) {
      alert('브리지 서버 URL을 입력해주세요.');
      return;
    }

    if (newSettings.authCookieObjects.length === 0 && newSettings.authCookies && !hasRequiredCookieNames(newSettings.authCookies)) {
      alert('필수 쿠키(ai_user, ai_session)가 부족합니다. 자동 감지 후 다시 저장해주세요.');
      return;
    }

    if (newSettings.authCookies) {
      try {
        const res = await sendMessageAsync({
          type: 'SET_COOKIES',
          cookies: newSettings.authCookies,
          cookieObjects: newSettings.authCookieObjects
        });
        if (!res?.success) {
          console.warn('SET_COOKIES:', res?.error);
        }
      } catch (e) {
        console.warn('SET_COOKIES failed', e);
      }
    }

    await chrome.storage.local.set({ settings: newSettings });
    const msg = document.getElementById('save-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2500);
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const { prompts = [] } = await chrome.storage.local.get('prompts');
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'nanobanana_prompts.json' });
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error();
      const { prompts = [] } = await chrome.storage.local.get('prompts');
      await chrome.storage.local.set({ prompts: [...imported, ...prompts] });
      alert(`${imported.length}개 프롬프트 가져옴!`);
    } catch {
      alert('파일 형식이 올바르지 않습니다.');
    }
    e.target.value = '';
  });

  document.getElementById('btn-clear-history').addEventListener('click', async () => {
    if (confirm('모든 히스토리를 삭제하시겠습니까?')) {
      await chrome.storage.local.set({ history: [] });
      alert('삭제되었습니다.');
    }
  });
});
