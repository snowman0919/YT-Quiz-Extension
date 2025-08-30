const YT_MATCHER = /https?:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_\-]{6,})/;

const tabState = new Map();

function getVideoIdFromUrl(url) {
  const match = url.match(YT_MATCHER);
  if (match && match[1]) return match[1];

  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        if (id) return id;
      }
      if (u.searchParams.get("v")) return u.searchParams.get("v");
    }
  } catch (e) {}
  return null;
}

async function getOptions() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["geminiApiKey", "quizDifficulty", "quizCount"], (res) => {
      resolve({
        apiKey: res.geminiApiKey || "",
        difficulty: Number(res.quizDifficulty || 3),
        count: Number(res.quizCount || 5)
      });
    });
  });
}

async function fetchTranscript(videoId) {
  const languagesToTry = ["ko", "en", "en-US", "en-GB", "ko-KR"];
  for (const lang of languagesToTry) {
    try {
      const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(videoId)}`;
      const resp = await fetch(url, { credentials: "omit" });
      if (!resp.ok) continue;
      const xml = await resp.text();
      if (!xml || xml.includes("<transcript></transcript>")) continue;
      const text = xml
        .replace(/<\/?transcript[^>]*>/g, "")
        .replace(/<text[^>]*>/g, "\n")
        .replace(/<\/?text>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      const cleaned = text
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)
        .join("\n");
      if (cleaned) return cleaned;
    } catch (e) {
    }
  }
  return "";
}

async function callGeminiSummarizeAndQuiz({ apiKey, transcript, title, url, difficulty, count }) {
  const models = ["gemini-1.5-pro-latest", "gemini-1.5-flash-latest"];
  const totalCount = Math.min(10, Math.max(1, Number(count || 5)));
  const level = Math.min(5, Math.max(1, Number(difficulty || 3)));
  const generationConfig = {
    temperature: 0.2,
    topK: 32,
    topP: 0.9,
    maxOutputTokens: 4096
  };
  const prompt = `다음은 유튜브 영상의 자막/내용입니다. 이를 기반으로 다음을 한국어로 자세히 만들어 주세요.
1) 고유명사 및 핵심 용어 목록
2) 흐름 요약 (도입-전개-결론으로 구조화)
3) 영상에서 전하고자 하는 핵심 메시지 3~5개
4) 퀴즈 출제 지침
   - 총 문항 수: ${totalCount}문항
   - 구성: 객관식(MC)와 서답형(FR)을 혼합. FR은 최소 ${Math.max(1, Math.floor(totalCount/3))}문항 포함
   - 객관식(MC): 보기 4개, 정답 인덱스 0~3, 중복선지 금지, 함정 보기 포함
   - 서답형(FR): 고유명사/핵심 어휘/핵심 개념을 확인하는 단답형. 정답 문장 예시(reference_answer)와 핵심 키워드 최소 3개(keywords)를 제공
   - 난이도: 1(매우 쉬움)~5(매우 어려움) 중 ${level} 수준으로 출제
   - 난이도 가이드 예시
     1: 표면적 사실/용어 정의 확인(예: "영상에서 소개한 모델 이름은?")
     2: 핵심 개념과 용어 매칭(예: "X의 정의를 한 문장으로 서술")
     3: 흐름 상 인과관계/핵심 메시지 요약(예: "왜 A가 B로 이어지는지 1~2문장")
     4: 비교/대조와 적용 상황 제시(예: "방법 A와 B의 차이를 요점 2개로 서술")
     5: 개념 종합/추론(예: "영상의 주장에 근거해 Z 상황에서의 선택을 한 문장으로 정당화")

5) 요약은 더 상세히 다음을 포함하세요.
   - 용어 정의 목록(definitions): {term, definition} 배열
   - 핵심 개념 개요(outline): 5~10개의 불릿으로 논리적 전개 요약
   - 오해/주의사항(misconceptions): 최소 3개
   - 실천 단계(actionable_steps): 3~5개

중요: 오직 순수 JSON만 출력하세요. 마크다운 코드펜스(\`\`\`)나 설명 문장은 출력하지 마세요. 모든 문자열은 쌍따옴표를 사용하고, 후행 콤마를 넣지 마세요.

출력 형식(JSON):
{
  "named_entities": string[],
  "flow": { "intro": string, "development": string, "conclusion": string },
  "key_messages": string[],
  "definitions": [{ "term": string, "definition": string }],
  "outline": string[],
  "misconceptions": string[],
  "actionable_steps": string[],
  "quizzes_mc": [
    { "question": string, "options": string[], "answer": number }
  ],
  "quizzes_fr": [
    { "question": string, "reference_answer": string, "keywords": string[] }
  ]
}

영상 제목: ${title || ""}
영상 URL: ${url}
자막/내용:
${transcript.slice(0, 15000)}
`;

  const body = {
    contents: [
      { role: "user", parts: [{ text: prompt }] }
    ],
    generationConfig
  };

  let lastErr = null;
  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      lastErr = new Error(`Gemini API error ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = extractJsonFromText(text);
    return parsed;
  }
  throw lastErr || new Error("Gemini call failed");
}

function extractJsonFromText(text) {
  let t = String(text || "").trim();
  if (t.includes("```")) {
    const first = t.indexOf("```");
    const last = t.lastIndexOf("```");
    if (last > first) {
      t = t.slice(first + 3, last).trim();
      const firstLineEnd = t.indexOf("\n");
      const firstLine = firstLineEnd === -1 ? t : t.slice(0, firstLineEnd).trim();
      if (/^json$/i.test(firstLine)) {
        t = firstLineEnd === -1 ? "" : t.slice(firstLineEnd + 1).trim();
      }
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`PARSE_JSON_FAILED: ${e.message}`);
  }
}

async function saveRecord({ videoId, url, title, summary, quizzes, result }) {
  const key = `record:${videoId}`;
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [key]: {
          videoId,
          url,
          title,
          createdAt: Date.now(),
          summary,
          quizzes,
          result
        }
      },
      () => resolve()
    );
  });
}

function setGate(tabId, gated) {
  const state = tabState.get(tabId) || {};
  state.gated = gated;
  tabState.set(tabId, state);
}

chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "REQUEST_SUMMARY_AND_QUIZ") {
    (async () => {
      try {
        const { tab } = sender;
        if (!tab?.id || !message.url) return;
        const videoId = getVideoIdFromUrl(message.url);
        if (!videoId) return;
        setGate(tab.id, true);

        const { apiKey, difficulty, count } = await getOptions();
        if (!apiKey) {
          sendResponse({ ok: false, error: "NO_API_KEY" });
          return;
        }

        const transcript = await fetchTranscript(videoId);
        const result = await callGeminiSummarizeAndQuiz({
          apiKey,
          transcript,
          title: message.title,
          url: message.url,
          difficulty,
          count
        });
        const summary = {
          named_entities: result.named_entities || [],
          flow: result.flow || {},
          key_messages: result.key_messages || [],
          definitions: result.definitions || [],
          outline: result.outline || [],
          misconceptions: result.misconceptions || [],
          actionable_steps: result.actionable_steps || []
        };
        const desired = Math.min(10, Math.max(1, Number(count || 5)));
        const quizzes_mc = Array.isArray(result.quizzes_mc) ? result.quizzes_mc : [];
        const quizzes_fr = Array.isArray(result.quizzes_fr) ? result.quizzes_fr : [];
        const combined = [];
        let i = 0, j = 0;
        while (combined.length < desired && (i < quizzes_mc.length || j < quizzes_fr.length)) {
          if (i < quizzes_mc.length) combined.push({ type: 'mc', ...quizzes_mc[i++] });
          if (combined.length < desired && j < quizzes_fr.length) combined.push({ type: 'fr', ...quizzes_fr[j++] });
        }
        const quizzes = combined.slice(0, desired);

        await saveRecord({ videoId, url: message.url, title: message.title, summary, quizzes });
        sendResponse({ ok: true, summary, quizzes });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (message?.type === "QUIZ_FINISHED") {
    (async () => {
      const tabId = sender?.tab?.id;
      if (!tabId) return;
      setGate(tabId, false);
      const videoId = getVideoIdFromUrl(message.url || "");
      if (videoId) {
        await saveRecord({
          videoId,
          url: message.url,
          title: message.title,
          summary: message.summary,
          quizzes: message.quizzes,
          result: message.result
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "CHECK_GATE") {
    const tabId = sender?.tab?.id;
    const gated = tabId ? Boolean(tabState.get(tabId)?.gated) : false;
    sendResponse({ gated });
    return true;
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const { tabId, url, frameId } = details;
  if (frameId !== 0) return;
  const gated = Boolean(tabState.get(tabId)?.gated);
  if (!gated) return;
  chrome.tabs.sendMessage(tabId, { type: "BLOCK_NAVIGATION", url });
}, { url: [{ hostContains: "youtube.com" }] });
