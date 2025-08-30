function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function setStatus(message, isError = false) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.style.color = isError ? '#d93025' : '#2a6df4';
  if (!isError) setTimeout(() => { el.textContent = ''; }, 1500);
}

function renderList(entries) {
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (const r of entries) {
    const div = document.createElement('div');
    div.className = 'item';
    const date = new Date(r.createdAt);
    div.innerHTML = `
      <div><a href="${r.url}" target="_blank">${escapeHtml(r.title || r.videoId)}</a></div>
      <div class="muted">${date.toLocaleString()}</div>
      <details style="margin-top:8px;">
        <summary>요약 보기</summary>
        <pre>${escapeHtml(JSON.stringify(r.summary, null, 2))}</pre>
      </details>
      <details style="margin-top:8px;">
        <summary>퀴즈 보기</summary>
        <pre>${escapeHtml(JSON.stringify(r.quizzes, null, 2))}</pre>
      </details>
      <details style="margin-top:8px;">
        <summary>결과 보기</summary>
        <pre>${escapeHtml(JSON.stringify(r.result, null, 2))}</pre>
      </details>
    `;
    list.appendChild(div);
  }
}

function loadAll() {
  chrome.storage.local.get(null, (res) => {
    const entries = Object.entries(res).filter(([k]) => k.startsWith('record:'))
      .map(([_, v]) => v).sort((a,b) => b.createdAt - a.createdAt);
    renderList(entries);
    document.getElementById('export').onclick = () => {
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'yt-quiz-records.json'; a.click();
      URL.revokeObjectURL(url);
      setStatus('내보내기 완료');
    };
    document.getElementById('clear').onclick = () => {
      const toRemove = Object.keys(res).filter((k) => k.startsWith('record:'));
      if (toRemove.length === 0) {
        setStatus('삭제할 항목이 없습니다');
        return;
      }
      chrome.storage.local.remove(toRemove, () => {
        setStatus('삭제 완료');
        loadAll();
      });
    };
  });
}

document.addEventListener('DOMContentLoaded', loadAll);


