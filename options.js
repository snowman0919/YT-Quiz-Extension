function updateStatus(message, isError = false) {
  const s = document.getElementById('status');
  s.textContent = message;
  s.style.color = isError ? '#d93025' : '#2a6df4';
  if (!isError) {
    setTimeout(() => { s.textContent = ''; }, 1500);
  }
}

function load() {
  chrome.storage.sync.get(['geminiApiKey','quizDifficulty','quizCount'], (res) => {
    document.getElementById('api').value = res.geminiApiKey || '';
    const diff = Number(res.quizDifficulty || 3);
    const cnt = Number(res.quizCount || 5);
    document.getElementById('difficulty').value = String(Math.min(5, Math.max(1, diff)));
    document.getElementById('qcount').value = String(Math.min(10, Math.max(1, cnt)));
  });
}

function save() {
  const key = document.getElementById('api').value.trim();
  const difficulty = Math.min(5, Math.max(1, Number(document.getElementById('difficulty').value)));
  const count = Math.min(10, Math.max(1, Number(document.getElementById('qcount').value)));
  if (!key) {
    updateStatus('API 키를 입력하세요', true);
    return;
  }
  chrome.storage.sync.set({ geminiApiKey: key, quizDifficulty: difficulty, quizCount: count }, () => {
    updateStatus('저장되었습니다');
  });
}

function toggleVisibility() {
  const input = document.getElementById('api');
  const btn = document.getElementById('toggle');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '숨김';
  } else {
    input.type = 'password';
    btn.textContent = '표시';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('toggle').addEventListener('click', toggleVisibility);
});


