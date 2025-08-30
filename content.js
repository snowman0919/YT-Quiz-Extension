let blockingOverlay = null;
let quizData = null;
let quizResult = null;
let videoTitleCache = "";
let isGated = false;
let endListenerAttachedForUrl = "";
let generatingToast = null;
const triggeredQuizForUrl = new Set();

function getCurrentUrl() {
  return window.location.href;
}

function getVideoTitle() {
  // Try to capture YouTube title from DOM
  const el = document.querySelector('h1.title, h1.ytd-watch-metadata, h1 .ytd-watch-metadata, #title h1, #title #container h1');
  const text = el?.innerText?.trim();
  return text || document.title.replace(/ - YouTube$/, "");
}

function ensureStyles() {
  if (document.getElementById("ytqz-style")) return;
  const style = document.createElement("style");
  style.id = "ytqz-style";
  style.textContent = `
    .ytqz-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(2px);
      z-index: 999999;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ytqz-modal {
      width: min(860px, 92vw);
      max-height: 90vh;
      overflow: auto;
      background: #111;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 20px 24px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .ytqz-modal h2 { margin: 6px 0 12px; font-size: 18px; }
    .ytqz-section { margin: 12px 0; }
    .ytqz-bullets { margin: 6px 0 0 16px; }
    .ytqz-question { margin: 12px 0; padding: 12px; background: #181818; border-radius: 8px; }
    .ytqz-option { display: block; margin: 6px 0; padding: 8px; background: #202020; border-radius: 6px; cursor: pointer; }
    .ytqz-option.correct { background: #163418; border: 1px solid #2ea043; }
    .ytqz-option.wrong { background: #3a1e1e; border: 1px solid #d93025; }
    .ytqz-correct-label { color: #8ce99a; font-size: 12px; margin-top: 6px; }
    .ytqz-action { margin-top: 12px; display: flex; gap: 8px; }
    .ytqz-button { padding: 8px 12px; border-radius: 8px; border: 1px solid #444; background: #2a6df4; color: #fff; cursor: pointer; }
    .ytqz-button.secondary { background: #333; }
    .ytqz-note { color: #bbb; font-size: 12px; margin-top: 8px }
    .ytqz-toast { position: fixed; top: 16px; right: 16px; z-index: 1000000; background: rgba(20,20,20,0.95); color: #fff; border: 1px solid #333; border-radius: 10px; padding: 10px 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); font-size: 13px; }
    .ytqz-toast .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #666; border-top-color: #fff; border-radius: 50%; margin-right: 8px; animation: ytqz-spin 0.8s linear infinite; vertical-align: -2px; }
    @keyframes ytqz-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  document.documentElement.appendChild(style);
}

function showGeneratingToast() {
  ensureStyles();
  hideGeneratingToast();
  generatingToast = document.createElement('div');
  generatingToast.className = 'ytqz-toast';
  generatingToast.innerHTML = `<span class="spinner"></span>요약/퀴즈 생성 중...`;
  document.documentElement.appendChild(generatingToast);
}

function hideGeneratingToast() {
  if (generatingToast) {
    generatingToast.remove();
    generatingToast = null;
  }
}

function showOverlay(summary, quizzes) {
  ensureStyles();
  if (blockingOverlay) blockingOverlay.remove();
  blockingOverlay = document.createElement("div");
  blockingOverlay.className = "ytqz-overlay";
  const modal = document.createElement("div");
  modal.className = "ytqz-modal";
  const title = getVideoTitle();
  const flow = summary?.flow || {};
  const entities = summary?.named_entities || [];
  const messages = summary?.key_messages || [];
  modal.innerHTML = `
    <h2>학습 요약: ${escapeHtml(title)}</h2>
    <div class="ytqz-section"><strong>고유명사/핵심 용어</strong>
      <ul class="ytqz-bullets">${entities.map((e)=>`<li>${escapeHtml(e)}</li>`).join("")}</ul>
    </div>
    <div class="ytqz-section"><strong>흐름 요약</strong>
      <div>도입: ${escapeHtml(flow.intro || "")}</div>
      <div>전개: ${escapeHtml(flow.development || "")}</div>
      <div>결론: ${escapeHtml(flow.conclusion || "")}</div>
    </div>
    <div class="ytqz-section"><strong>핵심 메시지</strong>
      <ul class="ytqz-bullets">${messages.map((m)=>`<li>${escapeHtml(m)}</li>`).join("")}</ul>
    </div>
    <div class="ytqz-section"><strong>퀴즈</strong>
      <div id="ytqz-quiz"></div>
      <div class="ytqz-action">
        <button id="ytqz-submit" class="ytqz-button">퀴즈 제출</button>
        <button id="ytqz-cancel" class="ytqz-button secondary">닫기(학습 중 이동 제한)</button>
      </div>
      <div class="ytqz-note">정답 여부와 관계없이 제출하면 이동 제한이 해제됩니다.</div>
    </div>
  `;
  blockingOverlay.appendChild(modal);
  document.documentElement.appendChild(blockingOverlay);

  renderQuiz(quizzes);
  document.getElementById("ytqz-submit").addEventListener("click", onSubmitQuiz);
  document.getElementById("ytqz-cancel").addEventListener("click", () => {
    blockingOverlay?.remove();
  });
}

function renderQuiz(quizzes) {
  const container = document.getElementById("ytqz-quiz");
  container.innerHTML = "";
  quizData = quizzes || [];
  quizResult = { answers: [], correctCount: 0 };
  quizData.forEach((q, i) => {
    const block = document.createElement("div");
    block.className = "ytqz-question";
    if (q.type === 'fr') {
      const inputId = `ytqz-fr-${i}`;
      block.innerHTML = `<div><strong>Q${i+1}. ${escapeHtml(q.question || "")}</strong></div>
        <div style="margin-top:8px;"><input id="${inputId}" type="text" placeholder="답안을 입력하세요" style="width:100%;padding:8px;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#fff;"></div>`;
    } else {
      const optionsHtml = (q.options || []).map((opt, idx) => {
        const id = `ytqz-q${i}-o${idx}`;
        return `<label class="ytqz-option"><input type="radio" name="ytqz-q${i}" value="${idx}" id="${id}"> ${escapeHtml(opt)}</label>`;
      }).join("");
      block.innerHTML = `<div><strong>Q${i+1}. ${escapeHtml(q.question || "")}</strong></div>${optionsHtml}`;
    }
    container.appendChild(block);
  });
}

function onSubmitQuiz() {
  const answers = quizData.map((q, i) => {
    if (q.type === 'fr') {
      const input = document.getElementById(`ytqz-fr-${i}`);
      return { text: (input?.value || '').trim() };
    }
    const sel = document.querySelector(`input[name="ytqz-q${i}"]:checked`);
    return sel ? Number(sel.value) : -1;
  });
  let correct = 0;
  answers.forEach((a, i) => {
    const q = quizData[i];
    if (q.type === 'fr') {
      const user = (a.text || '').toLowerCase();
      const keywords = (q.keywords || []).map(s => String(s).toLowerCase());
      const matched = keywords.filter(k => user.includes(k)).length;
      if (matched >= Math.max(1, Math.floor(keywords.length * 0.5))) correct += 1;
    } else if (a === Number(q?.answer)) {
      correct += 1;
    }
  });
  quizResult = { answers, correctCount: correct, total: quizData.length };

  // Reveal correct/incorrect immediately in UI
  quizData.forEach((q, i) => {
    const options = document.querySelectorAll(`input[name="ytqz-q${i}"]`);
    if (q.type === 'fr') {
      const input = document.getElementById(`ytqz-fr-${i}`);
      if (input) input.disabled = true;
      const container = input?.closest('.ytqz-question');
      if (container && !container.querySelector('.ytqz-correct-label')) {
        const msg = document.createElement('div');
        msg.className = 'ytqz-correct-label';
        const kws = Array.isArray(q.keywords) ? q.keywords.join(', ') : '';
        msg.textContent = `모범답안: ${q.reference_answer || ''}  |  키워드: ${kws}`;
        container.appendChild(msg);
      }
    } else {
      options.forEach((optEl) => {
        const label = optEl.closest('label');
        label.classList.remove('correct', 'wrong');
        const idx = Number(optEl.value);
        if (idx === Number(q.answer)) {
          label.classList.add('correct');
        }
        if (optEl.checked && idx !== Number(q.answer)) {
          label.classList.add('wrong');
        }
      });
      const container = options[0]?.closest('.ytqz-question');
      if (container && !container.querySelector('.ytqz-correct-label')) {
        const msg = document.createElement('div');
        msg.className = 'ytqz-correct-label';
        msg.textContent = `정답: ${Number.isInteger(q.answer) && q.options[q.answer] ? q.options[q.answer] : '알 수 없음'}`;
        container.appendChild(msg);
      }
    }
  });

  const payload = {
    type: "QUIZ_FINISHED",
    url: getCurrentUrl(),
    title: getVideoTitle(),
    summary: window.__ytqz_summary || null,
    quizzes: quizData,
    result: quizResult
  };
  chrome.runtime.sendMessage(payload, (res) => {
    // Remove gate, but keep overlay open so the user can review answers
    isGated = false;

    // Disable further changes to answers
    document.querySelectorAll('#ytqz-quiz input[type="radio"], #ytqz-quiz input[type="text"]').forEach((el) => {
      el.disabled = true;
    });

    // Turn submit button into a close button with score label
    const submitBtn = document.getElementById('ytqz-submit');
    if (submitBtn) {
      const newBtn = submitBtn.cloneNode(true);
      newBtn.textContent = `닫기 (점수: ${quizResult.correctCount}/${quizResult.total})`;
      newBtn.addEventListener('click', () => {
        blockingOverlay?.remove();
      });
      submitBtn.parentNode.replaceChild(newBtn, submitBtn);
    }

    // Hide the secondary cancel button to avoid confusion
    const cancelBtn = document.getElementById('ytqz-cancel');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
    }
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]|'/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function requestSummaryAndQuiz() {
  const url = getCurrentUrl();
  const title = getVideoTitle();
  videoTitleCache = title;
  isGated = true;
  showGeneratingToast();
  chrome.runtime.sendMessage({ type: "REQUEST_SUMMARY_AND_QUIZ", url, title }, (res) => {
    if (!res || !res.ok) {
      hideGeneratingToast();
      const msg = formatGateError(res?.error);
      showMinimalGate(msg);
      return;
    }
    hideGeneratingToast();
    window.__ytqz_summary = res.summary;
    showOverlay(res.summary, res.quizzes);
  });
}

function showMinimalGate(msg) {
  ensureStyles();
  if (blockingOverlay) blockingOverlay.remove();
  blockingOverlay = document.createElement("div");
  blockingOverlay.className = "ytqz-overlay";
  const modal = document.createElement("div");
  modal.className = "ytqz-modal";
  modal.innerHTML = `
    <h2>학습 모드</h2>
    <div class="ytqz-section">${escapeHtml(msg)}</div>
    <div class="ytqz-action">
      <button id="ytqz-close" class="ytqz-button">닫기</button>
    </div>
  `;
  blockingOverlay.appendChild(modal);
  document.documentElement.appendChild(blockingOverlay);
  document.getElementById("ytqz-close").addEventListener("click", () => blockingOverlay?.remove());
}

// Listen to page changes and navigation blocks
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BLOCK_NAVIGATION") {
    // show overlay again if trying to navigate away while gated
    if (!blockingOverlay) {
      showMinimalGate("학습 퀴즈를 먼저 완료하세요");
    }
  }
});

// Toggle from popup to trigger fetch and show overlay
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "toggleFeature") {
    requestSummaryAndQuiz();
    sendResponse({ ok: true });
  }
});

// Attach an 'ended' listener to the YouTube video element so the quiz shows when video finishes
function attachVideoEndListener() {
  const u = getCurrentUrl();
  if (!/youtube\.com\/(watch\?v=|shorts\/)/.test(u)) return;
  const video = getPrimaryVideo();
  if (!video) return;
  if (endListenerAttachedForUrl === u && video.dataset.ytqzBound === '1') return;
  try {
    video.removeEventListener('ended', handleVideoEnded);
    video.removeEventListener('timeupdate', handleTimeUpdateNearEnd);
  } catch (e) {}
  video.addEventListener('ended', handleVideoEnded, { once: false });
  video.addEventListener('timeupdate', handleTimeUpdateNearEnd, { once: false });
  video.dataset.ytqzBound = '1';
  endListenerAttachedForUrl = u;
}

function handleVideoEnded() {
  // When video ends, open the quiz and gate navigation
  requestSummaryAndQuiz();
}

function handleTimeUpdateNearEnd(e) {
  const v = e.currentTarget;
  if (!v || !v.duration || !isFinite(v.duration) || v.duration < 3) return;
  const ratio = v.currentTime / v.duration;
  if (ratio >= 0.985) {
    v.removeEventListener('timeupdate', handleTimeUpdateNearEnd);
    // Some Shorts loop instead of firing 'ended'; trigger once per URL
    if (!triggeredQuizForUrl.has(location.href)) {
      triggeredQuizForUrl.add(location.href);
      requestSummaryAndQuiz();
    }
  }
}

function getPrimaryVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return null;
  const vh = window.innerHeight, vw = window.innerWidth;
  let best = null, bestScore = -1;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const visibleW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const area = visibleW * visibleH;
    if (area > bestScore) { best = v; bestScore = area; }
  }
  return best;
}

function onUrlChange() {
  // On URL changes within YouTube, (re)bind end listener
  setTimeout(attachVideoEndListener, 300);
}

let lastUrl = location.href;
new MutationObserver(() => {
  const current = location.href;
  if (current !== lastUrl) {
    lastUrl = current;
    onUrlChange();
  }
}).observe(document, { subtree: true, childList: true });

// Initial
onUrlChange();
setTimeout(attachVideoEndListener, 500);

// Robust gating: intercept anchor clicks and SPA navigations
function findAnchor(element) {
  let el = element;
  while (el && el !== document.documentElement) {
    if (el.tagName === 'A' && el.href) return el;
    el = el.parentElement;
  }
  return null;
}

document.addEventListener('click', (e) => {
  if (!isGated) return;
  const anchor = findAnchor(e.target);
  if (anchor && /youtube\.com\//.test(anchor.href)) {
    e.preventDefault();
    e.stopPropagation();
    showMinimalGate("퀴즈 제출 전에는 이동할 수 없습니다");
  }
}, true);

// Block keyboard shortcuts that trigger navigation
document.addEventListener('keydown', (e) => {
  if (!isGated) return;
  const blockedCombos = (
    (e.key === 'N' && e.shiftKey) || // Next video
    (e.key === 'ArrowUp' && e.altKey) ||
    (e.key === 'ArrowRight' && e.metaKey) ||
    (e.key === 'BrowserForward')
  );
  if (blockedCombos) {
    e.preventDefault();
    e.stopPropagation();
    showMinimalGate("퀴즈 제출 전에는 이동할 수 없습니다");
  }
}, true);

// Intercept history changes for SPA navigation
(function wrapHistory() {
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function(...args) {
    if (isGated) {
      showMinimalGate("퀴즈 제출 전에는 이동할 수 없습니다");
      return; // block
    }
    return originalPush.apply(this, args);
  };
  history.replaceState = function(...args) {
    if (isGated) {
      showMinimalGate("퀴즈 제출 전에는 이동할 수 없습니다");
      return; // block
    }
    return originalReplace.apply(this, args);
  };
})();



// Error message helper placed at end (function declarations are hoisted)
function formatGateError(error) {
  const err = String(error || "");
  const upper = err.toUpperCase();
  if (upper.includes("NO_API_KEY")) return "Gemini API 키가 설정되어 있지 않습니다. 옵션에서 설정하세요.";
  if (upper.includes("PARSE_JSON_FAILED")) return "모델 응답 파싱에 실패했어요. 다시 시도해 주세요.";
  if (upper.includes("GEMINI API ERROR")) return "Gemini API 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
  return `요약/퀴즈 생성 실패: ${err || '알 수 없는 오류'}`;
}
