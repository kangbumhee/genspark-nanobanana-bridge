function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');

  countEl.textContent = history.length ? `총 ${history.length}건` : '기록 없음';

  if (!history.length) {
    list.innerHTML = '<p class="empty-history">아직 생성 기록이 없습니다.<br>팝업에서 이미지를 생성하면 여기에 표시됩니다.</p>';
    return;
  }

  list.innerHTML = '';
  history.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-meta">${escapeHtml(formatDate(item.createdAt))} · ${item.count || (item.images || []).length}장 · ${item.elapsed != null ? item.elapsed + '초' : '-'}</div>
      <div class="history-prompt">${escapeHtml(item.prompt || '')}</div>
      <div class="history-thumbs"></div>
      <div class="history-actions"></div>
    `;

    const thumbs = div.querySelector('.history-thumbs');
    (item.images || []).slice(0, 12).forEach((url, i) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('click', () => window.open(url, '_blank'));
      thumbs.appendChild(img);
    });

    const actions = div.querySelector('.history-actions');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn-sm';
    openBtn.textContent = 'URL 한 줄 복사';
    openBtn.addEventListener('click', () => {
      navigator.clipboard.writeText((item.images || []).join('\n'));
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn-sm';
    dlBtn.textContent = '이 항목 전부 저장';
    dlBtn.addEventListener('click', () => {
      (item.images || []).forEach((url, i) => {
        chrome.downloads.download({ url, filename: `history_${item.id}_${i + 1}.png` });
      });
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-sm';
    delBtn.textContent = '이 항목 삭제';
    delBtn.addEventListener('click', async () => {
      const { history: h = [] } = await chrome.storage.local.get('history');
      await chrome.storage.local.set({ history: h.filter((x) => x.id !== item.id) });
      renderHistory();
    });

    actions.appendChild(openBtn);
    actions.appendChild(dlBtn);
    actions.appendChild(delBtn);
    list.appendChild(div);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('모든 히스토리를 삭제할까요?')) return;
    await chrome.storage.local.set({ history: [] });
    renderHistory();
  });
});
