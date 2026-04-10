/* ======================================================
   🍌 나노바나나 무료 스튜디오 — popup.js
   Genspark AI 이미지 생성 자동화
   ====================================================== */

let refImageData = null;
let refImageName = null;
let timerInterval = null;
let startTs = 0;
let batchRunning = false;
let allBatchResults = [];

document.addEventListener('DOMContentLoaded', async () => {
  await applyDefaultSettings();
  initTabs();
  initRefToggle();
  initDropZone();
  initPromptInput();
  initModeToggle();
  bindButtons();
  await loadSavedPrompts();
  renderPresets();
  await checkConnection();
});

async function applyDefaultSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const ratio = settings.defaultRatio || '1:1';
  const count = settings.defaultCount || '1';
  const ratioEl = document.getElementById('gen-ratio');
  const countEl = document.getElementById('gen-count');
  if (ratioEl && [...ratioEl.options].some(o => o.value === ratio)) ratioEl.value = ratio;
  if (countEl && [...countEl.options].some(o => o.value === count)) countEl.value = count;
}

async function checkConnection() {
  const bar = document.getElementById('status-bar');
  const text = document.getElementById('status-text');

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CHECK_AUTH_STATUS' }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });

    if (response?.success && response.authReady) {
      bar.className = 'status-bar connected';
      text.textContent = '✅ 브리지 서버 연결됨 — 이미지 생성 준비 완료';
    } else if (response?.success && !response.authReady) {
      bar.className = 'status-bar disconnected';
      text.textContent = '🔐 브리지 서버는 연결됐지만 Genspark 로그인이 필요합니다';
    } else {
      bar.className = 'status-bar disconnected';
      text.textContent = '⚠️ 브리지 상태 확인 실패';
    }
  } catch (e) {
    bar.className = 'status-bar disconnected';
    text.textContent = '❌ 브리지 연결 실패: ' + e.message;
  }
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
      });
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      target.classList.remove('hidden');
      target.classList.add('active');
    });
  });
}

function initRefToggle() {
  document.querySelectorAll('.ref-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ref-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ref-file-area').classList.toggle('active', btn.dataset.ref === 'file');
      document.getElementById('ref-file-area').classList.toggle('hidden', btn.dataset.ref !== 'file');
      document.getElementById('ref-url-area').classList.toggle('active', btn.dataset.ref === 'url');
      document.getElementById('ref-url-area').classList.toggle('hidden', btn.dataset.ref !== 'url');
    });
  });

  document.getElementById('btn-preview-url').addEventListener('click', async () => {
    const url = document.getElementById('ref-url-input').value.trim();
    if (!url) return;

    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        refImageData = reader.result;
        refImageName = 'product_from_url.png';
        showPreview('preview-url', reader.result);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      alert('이미지를 불러올 수 없습니다: ' + e.message);
    }
  });
}

function initDropZone() {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleFile(input.files[0]);
  });
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) return alert('이미지 파일만 업로드 가능합니다.');
  if (file.size > 10 * 1024 * 1024) return alert('10MB 이하 파일만 가능합니다.');

  const reader = new FileReader();
  reader.onload = () => {
    refImageData = reader.result;
    refImageName = file.name;
    showPreview('preview-file', reader.result);
    document.getElementById('drop-zone').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function showPreview(containerId, dataUrl) {
  const box = document.getElementById(containerId);
  box.classList.remove('hidden');
  box.innerHTML = '';

  const img = document.createElement('img');
  img.src = dataUrl;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    refImageData = null;
    refImageName = null;
    box.classList.add('hidden');
    box.innerHTML = '';
    document.getElementById('drop-zone').style.display = '';
    document.getElementById('file-input').value = '';
  });

  box.appendChild(img);
  box.appendChild(removeBtn);
}

function initPromptInput() {
  const input = document.getElementById('prompt-input');
  const counter = document.getElementById('prompt-length');
  input.addEventListener('input', () => {
    counter.textContent = String(input.value.length);
    if (input.value.length > 2000) input.value = input.value.substring(0, 2000);
  });
}

function initModeToggle() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.mode-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
      });
      const target = document.getElementById('mode-' + btn.dataset.mode);
      target.classList.remove('hidden');
      target.classList.add('active');
    });
  });
}

function bindButtons() {
  document.getElementById('btn-pin').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup', width: 520, height: 700, focused: true
    });
  });

  document.getElementById('btn-history').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('history.html'),
      type: 'popup', width: 600, height: 700, focused: true
    });
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('settings.html'),
      type: 'popup', width: 480, height: 500, focused: true
    });
  });

  document.getElementById('btn-load-prompt').addEventListener('click', () => {
    const sel = document.getElementById('saved-prompt-select');
    if (sel.value) {
      document.getElementById('prompt-input').value = sel.value;
      document.getElementById('prompt-length').textContent = String(sel.value.length);
    }
  });

  document.getElementById('btn-save-current').addEventListener('click', () => {
    const body = document.getElementById('prompt-input').value.trim();
    if (!body) return alert('프롬프트를 입력하세요.');
    const name = prompt('프롬프트 이름을 입력하세요:');
    if (!name) return;
    savePromptDirect(name, body, 'Shopee');
  });

  document.getElementById('btn-generate').addEventListener('click', generateSingle);
  document.getElementById('btn-batch-start').addEventListener('click', startBatch);
  document.getElementById('btn-batch-stop').addEventListener('click', stopBatch);

  document.getElementById('btn-save-prompt').addEventListener('click', savePrompt);
  document.getElementById('filter-category').addEventListener('change', loadSavedPrompts);
}

function buildPromptWithOptions(basePrompt) {
  const ratio = document.getElementById('gen-ratio')?.value;
  if (!ratio || ratio === '1:1') return basePrompt;
  return `[Aspect ratio ${ratio}] ${basePrompt}`;
}

async function generateSingle() {
  const rawPrompt = document.getElementById('prompt-input').value.trim();
  const prompt = buildPromptWithOptions(rawPrompt);
  if (!rawPrompt) return alert('프롬프트를 입력해주세요.');
  if (!refImageData) return alert('참조 이미지를 첨부해주세요.');

  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = '⏳ 생성 중...';

  const progressArea = document.getElementById('progress-area');
  const resultArea = document.getElementById('result-area');
  progressArea.classList.remove('hidden');
  resultArea.classList.add('hidden');
  document.getElementById('progress-detail').innerHTML = '';

  updateStatus('working', '🍌 이미지 생성 중...');
  startTimer();
  appendProgress('프롬프트: ' + prompt.substring(0, 60) + (prompt.length > 60 ? '…' : ''));
  appendProgress('참조 이미지: ' + (refImageName || '있음'));

  const count = parseInt(document.getElementById('gen-count').value, 10);
  const images = [];

  try {
    for (let i = 0; i < count; i++) {
      appendProgress(`이미지 ${i + 1}/${count} 생성 중...`);
      document.getElementById('progress-status').textContent = `🍌 ${i + 1}/${count} 생성 중...`;

      const result = await sendToGenspark(prompt, refImageData, refImageName);

      if (result?.images) {
        images.push(...result.images);
        appendProgress(`✅ 이미지 ${i + 1} 완료! (${result.elapsed}초)`);
      }

      if (i < count - 1) {
        appendProgress('다음 생성 대기 중...');
        await new Promise(r => setTimeout(r, 5000));
        await resetGensparkPage();
      }
    }

    stopTimer();

    if (images.length > 0) {
      document.getElementById('progress-status').textContent = '✅ 생성 완료!';
      document.getElementById('progress-fill').style.width = '100%';
      showResults(images);
      await saveToHistory(rawPrompt, images);
      updateStatus('connected', `✅ ${images.length}장 생성 완료`);
    } else {
      document.getElementById('progress-status').textContent = '❌ 생성 실패';
      updateStatus('disconnected', '❌ 생성 실패');
    }
  } catch (e) {
    stopTimer();
    document.getElementById('progress-status').textContent = '❌ 오류: ' + e.message;
    appendProgress('오류: ' + e.message);
    updateStatus('disconnected', '❌ 오류 발생');
  } finally {
    btn.disabled = false;
    btn.textContent = '🍌 이미지 생성하기';
  }
}

async function sendToGenspark(prompt, imageData, imageName) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'GENERATE_IMAGE',
      payload: { prompt, imageData, imageName }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || '알 수 없는 오류'));
      }
    });
  });
}

async function resetGensparkPage() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_GENSPARK_TAB' }, (res) => {
      if (res?.success && res.tabId) {
        chrome.tabs.update(res.tabId, { url: 'https://genspark.ai/ai_image' });
        setTimeout(resolve, 5000);
      } else {
        resolve();
      }
    });
  });
}

async function startBatch() {
  const rawBase = document.getElementById('prompt-input').value.trim();
  const isListMode = document.querySelector('.mode-btn.active').dataset.mode === 'list';
  if (!rawBase && !isListMode) {
    return alert('이미지 생성 탭에서 프롬프트를 설정해주세요.');
  }
  if (!refImageData) return alert('이미지 생성 탭에서 참조 이미지를 설정해주세요.');

  await checkConnection();

  batchRunning = true;
  allBatchResults = [];

  const batchCount = parseInt(document.getElementById('batch-count').value, 10);
  const interval = parseInt(document.getElementById('batch-interval').value, 10);

  let prompts = [];
  if (isListMode) {
    prompts = document.getElementById('batch-prompts').value
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);
    if (prompts.length === 0) return alert('프롬프트 목록을 입력해주세요.');
    prompts = prompts.map(p => buildPromptWithOptions(p));
  } else {
    prompts = Array(batchCount).fill(buildPromptWithOptions(rawBase));
  }

  const totalCount = Math.min(prompts.length, batchCount);

  document.getElementById('btn-batch-start').classList.add('hidden');
  document.getElementById('btn-batch-stop').classList.remove('hidden');
  document.getElementById('batch-progress').classList.remove('hidden');
  document.getElementById('batch-results').classList.add('hidden');
  document.getElementById('batch-total').textContent = totalCount;
  document.getElementById('batch-log').innerHTML = '';

  updateStatus('working', `🔄 반복 생성 중... 0/${totalCount}`);

  for (let i = 0; i < totalCount; i++) {
    if (!batchRunning) {
      appendBatchLog(`⛔ 사용자에 의해 중지됨 (${i}/${totalCount})`);
      break;
    }

    document.getElementById('batch-current').textContent = i;
    document.getElementById('batch-fill').style.width = (i / totalCount * 100) + '%';
    appendBatchLog(`[${i + 1}/${totalCount}] 생성 중... "${prompts[i].substring(0, 40)}"`);
    updateStatus('working', `🔄 ${i + 1}/${totalCount} 생성 중...`);

    try {
      if (i > 0) {
        await resetGensparkPage();
        await new Promise(r => setTimeout(r, interval * 1000));
      }

      const result = await sendToGenspark(prompts[i], refImageData, refImageName);

      if (result?.images) {
        allBatchResults.push(...result.images);
        appendBatchLog(`✅ [${i + 1}] 완료! ${result.images.length}장 (${result.elapsed}초)`);
      }
    } catch (e) {
      appendBatchLog(`❌ [${i + 1}] 실패: ${e.message}`);
    }

    document.getElementById('batch-current').textContent = i + 1;
  }

  document.getElementById('batch-fill').style.width = '100%';
  document.getElementById('btn-batch-start').classList.remove('hidden');
  document.getElementById('btn-batch-stop').classList.add('hidden');
  batchRunning = false;

  if (allBatchResults.length > 0) {
    showBatchResults(allBatchResults);
    await saveToHistory('반복 생성 (' + totalCount + '회)', allBatchResults);
    updateStatus('connected', `✅ 반복 생성 완료: ${allBatchResults.length}장`);
  } else {
    updateStatus('disconnected', '❌ 반복 생성 실패');
  }
}

function stopBatch() {
  batchRunning = false;
}

function appendBatchLog(msg) {
  const el = document.getElementById('batch-log');
  const time = new Date().toLocaleTimeString('ko-KR');
  const line = document.createElement('div');
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function showResults(images) {
  const area = document.getElementById('result-area');
  area.classList.remove('hidden');
  document.getElementById('result-count').textContent = `(${images.length}장)`;
  const grid = document.getElementById('result-grid');
  grid.innerHTML = '';

  const uniqueUrls = [...new Set(images)];

  uniqueUrls.forEach((url, i) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const img = document.createElement('img');
    img.src = url;
    img.alt = '생성 이미지 ' + (i + 1);
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(url, '_blank'));
    card.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'result-card-actions';

    const dlBtn = document.createElement('button');
    dlBtn.textContent = '💾 저장';
    dlBtn.addEventListener('click', () => {
      chrome.downloads.download({ url, filename: `nanobanana_${i + 1}.png` });
    });

    const cpBtn = document.createElement('button');
    cpBtn.textContent = '📋 복사';
    cpBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        cpBtn.textContent = '✅';
        setTimeout(() => { cpBtn.textContent = '📋 복사'; }, 1500);
      } catch {
        navigator.clipboard.writeText(url);
        cpBtn.textContent = '✅ URL';
        setTimeout(() => { cpBtn.textContent = '📋 복사'; }, 1500);
      }
    });

    actions.appendChild(dlBtn);
    actions.appendChild(cpBtn);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  document.getElementById('btn-download-all').onclick = () => {
    uniqueUrls.forEach((url, i) => {
      chrome.downloads.download({ url, filename: `nanobanana_${i + 1}.png` });
    });
  };

  document.getElementById('btn-copy-urls').onclick = () => {
    navigator.clipboard.writeText(uniqueUrls.join('\n'));
    alert('URL이 복사되었습니다!');
  };
}

function showBatchResults(images) {
  const area = document.getElementById('batch-results');
  area.classList.remove('hidden');
  document.getElementById('batch-result-count').textContent = `(${images.length}장)`;
  const grid = document.getElementById('batch-result-grid');
  grid.innerHTML = '';

  const uniqueUrls = [...new Set(images)];

  uniqueUrls.forEach((url, i) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(url, '_blank'));
    card.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'result-card-actions';
    const dlBtn = document.createElement('button');
    dlBtn.textContent = '💾';
    dlBtn.addEventListener('click', () => {
      chrome.downloads.download({ url, filename: `batch_${i + 1}.png` });
    });
    actions.appendChild(dlBtn);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  document.getElementById('btn-batch-download-all').onclick = () => {
    uniqueUrls.forEach((url, i) => {
      chrome.downloads.download({ url, filename: `batch_${i + 1}.png` });
    });
  };
}

function updateStatus(type, message) {
  const bar = document.getElementById('status-bar');
  const text = document.getElementById('status-text');
  bar.className = 'status-bar ' + type;
  text.textContent = message;
}

function startTimer() {
  startTs = Date.now();
  document.getElementById('progress-fill').style.width = '0%';
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTs) / 1000);
    document.getElementById('progress-timer').textContent = elapsed + '초';
    document.getElementById('progress-fill').style.width = Math.min(90, elapsed * 1.2) + '%';
  }, 500);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const elapsed = Math.round((Date.now() - startTs) / 1000);
  document.getElementById('progress-timer').textContent = elapsed + '초';
}

function appendProgress(msg) {
  const el = document.getElementById('progress-detail');
  const time = new Date().toLocaleTimeString('ko-KR');
  const line = document.createElement('div');
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

async function saveToHistory(prompt, images) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({
    id: Date.now(),
    prompt,
    images: [...new Set(images)],
    elapsed: Math.round((Date.now() - startTs) / 1000),
    createdAt: new Date().toISOString(),
    count: [...new Set(images)].length
  });
  if (history.length > 200) history.splice(200);
  await chrome.storage.local.set({ history });
}

async function savePrompt() {
  const name = document.getElementById('prompt-name').value.trim();
  const body = document.getElementById('prompt-body').value.trim();
  const category = document.getElementById('prompt-category').value;
  if (!name || !body) return alert('이름과 내용을 모두 입력하세요.');
  await savePromptDirect(name, body, category);
  document.getElementById('prompt-name').value = '';
  document.getElementById('prompt-body').value = '';
}

async function savePromptDirect(name, body, category) {
  const { prompts = [] } = await chrome.storage.local.get('prompts');
  prompts.unshift({ id: Date.now(), name, body, category, createdAt: new Date().toISOString() });
  await chrome.storage.local.set({ prompts });
  await loadSavedPrompts();
  alert('프롬프트가 저장되었습니다!');
}

async function loadSavedPrompts() {
  const { prompts = [] } = await chrome.storage.local.get('prompts');
  const filter = document.getElementById('filter-category')?.value || 'all';
  const filtered = filter === 'all' ? prompts : prompts.filter(p => p.category === filter);

  const sel = document.getElementById('saved-prompt-select');
  sel.innerHTML = '<option value="">— 프리셋 / 저장된 프롬프트 —</option>';

  getPresets().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.body;
    opt.textContent = '📦 ' + p.name;
    sel.appendChild(opt);
  });

  prompts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.body;
    opt.textContent = '💾 [' + p.category + '] ' + p.name;
    sel.appendChild(opt);
  });

  const list = document.getElementById('prompt-list');
  if (!filtered.length) {
    list.innerHTML = '<p class="empty-msg">저장된 프롬프트가 없습니다.</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(p => {
    const div = document.createElement('div');
    div.className = 'prompt-item';
    div.innerHTML = `
      <div class="prompt-item-header">
        <span class="prompt-item-name">${escapeHtml(p.name)}</span>
        <span class="prompt-item-cat">${escapeHtml(p.category)}</span>
      </div>
      <div class="prompt-item-body">${escapeHtml(p.body)}</div>
      <div class="prompt-item-actions"></div>
    `;

    const actions = div.querySelector('.prompt-item-actions');

    const useBtn = document.createElement('button');
    useBtn.className = 'btn-sm';
    useBtn.textContent = '사용';
    useBtn.addEventListener('click', () => {
      document.getElementById('prompt-input').value = p.body;
      document.getElementById('prompt-length').textContent = String(p.body.length);
      document.querySelector('.tab[data-tab="generate"]').click();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm';
    delBtn.style.color = 'var(--danger)';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', async () => {
      if (confirm('"' + p.name + '" 삭제?')) {
        const { prompts: all = [] } = await chrome.storage.local.get('prompts');
        await chrome.storage.local.set({ prompts: all.filter(x => x.id !== p.id) });
        loadSavedPrompts();
      }
    });

    actions.appendChild(useBtn);
    actions.appendChild(delBtn);
    list.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getPresets() {
  const SQ = 'IMPORTANT: This image MUST be a perfect square (1:1 ratio). ';
  const REF = 'If a reference product photo is attached, reproduce that EXACT product in the image. ';
  const TAIL = ' Photorealistic, ultra high quality, suitable for Shopee thumbnail.';

  return [
    {
      name: '🛒 Shopee 기본 — 모델+제품',
      category: 'Shopee',
      body: SQ + REF + 'Shopee product thumbnail. A young attractive Korean female model smiling brightly, holding the product near her face. Colorful pastel border frame. Bold English word "BEST" prominently displayed. Bright studio lighting, clean background.' + TAIL
    },
    {
      name: '🛒 Shopee — NEW 신상품',
      category: 'Shopee',
      body: SQ + REF + 'Shopee new product launch thumbnail. Korean female model with big cheerful smile presenting the product. Mint green border frame. The word "NEW" very large and bold. Fresh energetic mood with confetti elements.' + TAIL
    },
    {
      name: '🛒 Shopee — SALE 할인',
      category: 'Shopee',
      body: SQ + REF + 'Shopee sale promotion thumbnail. Korean female model holding product forward. Bold red and yellow border. "SALE" displayed very large in hot pink. Bright energetic lighting.' + TAIL
    },
    {
      name: '📸 제품 단독 — 화이트',
      category: '상품촬영',
      body: SQ + REF + 'Clean product photography on pure white background. Product centered perfectly. Professional studio lighting, sharp details.' + TAIL
    },
    {
      name: '🎨 일러스트 변환',
      category: '기타',
      body: SQ + 'Recreate the attached product in cute illustrated style. Flat design with soft pastel colors, clean vector-like appearance. Product clearly recognizable. Soft pastel gradient background.' + TAIL
    }
  ];
}

function renderPresets() {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';

  getPresets().forEach(p => {
    const div = document.createElement('div');
    div.className = 'prompt-item';
    div.innerHTML = `
      <div class="prompt-item-header">
        <span class="prompt-item-name">${escapeHtml(p.name)}</span>
        <span class="prompt-item-cat">${escapeHtml(p.category)}</span>
      </div>
      <div class="prompt-item-body">${escapeHtml(p.body)}</div>
      <div class="prompt-item-actions"></div>
    `;

    const actions = div.querySelector('.prompt-item-actions');

    const useBtn = document.createElement('button');
    useBtn.className = 'btn-sm';
    useBtn.textContent = '바로 사용';
    useBtn.addEventListener('click', () => {
      document.getElementById('prompt-input').value = p.body;
      document.getElementById('prompt-length').textContent = String(p.body.length);
      document.querySelector('.tab[data-tab="generate"]').click();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-sm';
    saveBtn.textContent = '💾 저장';
    saveBtn.addEventListener('click', () => savePromptDirect(p.name, p.body, p.category));

    actions.appendChild(useBtn);
    actions.appendChild(saveBtn);
    list.appendChild(div);
  });
}
