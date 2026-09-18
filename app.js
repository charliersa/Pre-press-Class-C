'use strict';

/* ==========================================================
   設定
   ========================================================== */
const CONFIG = {
  examCount: 80,         // 模擬測驗抽題數
  examMinutes: 100,      // 模擬測驗限時（分鐘）
  passScore: 60,         // 及格分數
  instantFeedback: true, // 練習／錯題模式作答後立即顯示正解
};

const STORAGE_KEYS = {
  wrong: 'ppc-wrong',       // 錯題本（題目 id 陣列）
  session: 'ppc-session',   // 作答中進度
  history: 'ppc-history',   // 近期成績
};
const HISTORY_LIMIT = 5;
const AUTO_ADVANCE_MS = 140; // 測驗模式選答後自動跳下一題的延遲
const LETTERS = ['A', 'B', 'C', 'D'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/* ==========================================================
   狀態
   ========================================================== */
const state = {
  bank: [],            // 全部題目 {id, q, o[], a, ch}
  byId: new Map(),     // id → 題目
  chapters: [],        // {name, count, num}

  view: 'loading',     // loading | home | quiz | result
  mode: null,          // exam | practice | wrong
  chapter: null,
  ids: [],             // 本次作答的題目 id
  answers: {},         // id → 選項 index
  idx: 0,              // 目前題號（0 起算）
  deadline: null,      // 測驗截止時間（ms），練習模式為 null
  started: null,
  endedAt: null,
  showPalette: false,

  wrong: [],
  history: [],
  saved: null,         // 上次未完成的作答
};

/* ==========================================================
   工具函式
   ========================================================== */
const $ = (id) => document.getElementById(id);

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 無法儲存時忽略 */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* 同上 */ }
  },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const pad2 = (n) => String(n).padStart(2, '0');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function modeLabel(mode, chapter) {
  if (mode === 'exam') return '模擬測驗';
  if (mode === 'wrong') return '錯題複習';
  return '章節精練' + (chapter ? ' · ' + chapter : '');
}

const optionText = (q, i) => `（${LETTERS[i]}）${q.o[i]}`;

/* ==========================================================
   題目與計分
   ========================================================== */
const quizQuestions = () => state.ids.map((id) => state.byId.get(id)).filter(Boolean);
const currentQuestion = () => quizQuestions()[state.idx];
const isInstant = () => state.mode !== 'exam' && CONFIG.instantFeedback;

function grade(qs, answers) {
  const correct = qs.filter((q) => answers[q.id] === q.a).length;
  const blank = qs.filter((q) => answers[q.id] === undefined).length;
  const score = qs.length ? Math.round((correct * 1000) / qs.length) / 10 : 0;
  return { correct, blank, wrong: qs.length - correct - blank, score };
}

function buildChapters(bank) {
  const map = new Map();
  bank.forEach((q) => map.set(q.ch, (map.get(q.ch) || 0) + 1));
  return [...map].map(([name, count], i) => ({ name, count, num: ROMAN[i] || String(i + 1) }));
}

/* ==========================================================
   作答流程
   ========================================================== */
function showView(view) {
  state.view = view;
  window.scrollTo(0, 0);
  render();
}

function saveSession() {
  if (state.view !== 'quiz') {
    storage.remove(STORAGE_KEYS.session);
    return;
  }
  const { mode, chapter, ids, answers, idx, deadline, started } = state;
  storage.set(STORAGE_KEYS.session, { mode, chapter, ids, answers, idx, deadline, started });
}

function begin(mode, ids, chapter = null) {
  if (!ids.length) return;
  Object.assign(state, {
    mode, chapter, ids,
    answers: {},
    idx: 0,
    deadline: mode === 'exam' ? Date.now() + CONFIG.examMinutes * 60000 : null,
    started: Date.now(),
    endedAt: null,
    showPalette: false,
    saved: null,
  });
  showView('quiz');
  saveSession();
}

function move(delta) {
  const last = state.ids.length - 1;
  const next = Math.min(last, Math.max(0, state.idx + delta));
  if (next === state.idx && delta > 0) return submit(); // 最後一題按「下一題」即交卷
  state.idx = next;
  renderQuiz();
  saveSession();
}

function pick(i) {
  const q = currentQuestion();
  if (!q) return;
  if (isInstant() && state.answers[q.id] !== undefined) return; // 已揭曉，不可改答

  state.answers = { ...state.answers, [q.id]: i };
  if (i !== q.a) {
    if (!state.wrong.includes(q.id)) state.wrong = [...state.wrong, q.id];
  } else {
    state.wrong = state.wrong.filter((id) => id !== q.id);
  }
  storage.set(STORAGE_KEYS.wrong, state.wrong);
  renderQuiz();
  saveSession();

  if (!isInstant()) {
    setTimeout(() => {
      if (state.view === 'quiz' && state.idx < state.ids.length - 1) move(1);
    }, AUTO_ADVANCE_MS);
  }
}

function submit() {
  const qs = quizQuestions();
  const { score } = grade(qs, state.answers);
  const entry = {
    date: new Date().toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }),
    mode: `${modeLabel(state.mode, state.chapter)}（${qs.length} 題）`,
    score,
  };
  state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
  storage.set(STORAGE_KEYS.history, state.history);
  storage.remove(STORAGE_KEYS.session);
  state.endedAt = Date.now();
  state.showPalette = false;
  showView('result');
}

const actions = {
  startExam() {
    begin('exam', shuffle(state.bank.map((q) => q.id)).slice(0, CONFIG.examCount));
  },
  startAll() {
    begin('practice', state.bank.map((q) => q.id), '全題庫');
  },
  startChapter(name) {
    begin('practice', state.bank.filter((q) => q.ch === name).map((q) => q.id), name);
  },
  startWrong() {
    const wrong = new Set(state.wrong);
    const ids = state.bank.filter((q) => wrong.has(q.id)).map((q) => q.id);
    if (!ids.length) return showView('home');
    begin('wrong', ids, '錯題本');
  },
  retry() {
    if (state.mode === 'exam') actions.startExam();
    else if (state.mode === 'wrong') actions.startWrong();
    else begin('practice', state.ids, state.chapter);
  },
  resume() {
    const s = state.saved;
    if (!s) return;
    Object.assign(state, {
      mode: s.mode,
      chapter: s.chapter,
      ids: s.ids,
      answers: s.answers || {},
      idx: s.idx || 0,
      deadline: s.deadline,
      started: s.started || Date.now(),
      endedAt: null,
      saved: null,
    });
    showView('quiz');
  },
  discard() {
    storage.remove(STORAGE_KEYS.session);
    state.saved = null;
    renderHome();
  },
  home() {
    storage.remove(STORAGE_KEYS.session);
    showView('home');
  },
  togglePalette() {
    state.showPalette = !state.showPalette;
    renderQuiz();
  },
  goto(i) {
    state.idx = Number(i);
    state.showPalette = false;
    renderQuiz();
    saveSession();
  },
  pick: (i) => pick(Number(i)),
  prev: () => move(-1),
  next: () => move(1),
  submit,
};

/* ==========================================================
   畫面繪製
   ========================================================== */
const VIEWS = ['loading', 'home', 'quiz', 'result'];

function render() {
  VIEWS.forEach((v) => { $('view-' + v).hidden = v !== state.view; });
  if (state.view === 'home') renderHome();
  else if (state.view === 'quiz') renderQuiz();
  else if (state.view === 'result') renderResult();
}

function renderHome() {
  $('bank-count').textContent = state.bank.length;
  $('chapter-count').textContent = state.chapters.length;
  $('exam-count').textContent = CONFIG.examCount;
  $('exam-minutes').textContent = CONFIG.examMinutes;
  $('pass-score').textContent = CONFIG.passScore;
  $('home-wrong-count').textContent = state.wrong.length;

  const saved = state.saved;
  $('resume-card').hidden = !saved;
  if (saved) {
    $('saved-label').textContent =
      `${modeLabel(saved.mode, saved.chapter)}　第 ${(saved.idx || 0) + 1} / ${saved.ids.length} 題`;
  }

  $('chapter-list').innerHTML = state.chapters.map((c) => `
    <button class="chapter" data-action="startChapter" data-arg="${esc(c.name)}">
      <span class="chapter-info">
        <span class="chapter-num">${c.num}</span>
        <span class="chapter-name">${esc(c.name)}</span>
      </span>
      <span class="chapter-count">${c.count}</span>
    </button>`).join('');

  $('history').hidden = !state.history.length;
  $('history-list').innerHTML = state.history.map((h) => `
    <div class="history-row">
      <span class="history-date">${esc(h.date)}</span>
      <span class="history-mode">${esc(h.mode)}</span>
      <span class="history-score">${esc(h.score)}</span>
    </div>`).join('');
}

function renderTimer() {
  const timer = $('timer');
  timer.hidden = !state.deadline;
  if (!state.deadline) return;
  const left = Math.max(0, state.deadline - Date.now());
  timer.textContent = pad2(Math.floor(left / 60000)) + ':' + pad2(Math.floor((left % 60000) / 1000));
}

function renderQuiz() {
  const qs = quizQuestions();
  const q = currentQuestion();
  const { answers, idx } = state;

  $('quiz-mode').textContent = modeLabel(state.mode, state.chapter);
  $('quiz-no').textContent = idx + 1;
  $('quiz-total').textContent = qs.length;
  $('quiz-answered').textContent = qs.filter((x) => answers[x.id] !== undefined).length;
  $('progress-bar').style.width = (qs.length ? ((idx + 1) / qs.length) * 100 : 0) + '%';
  renderTimer();

  const palette = $('palette');
  palette.hidden = !state.showPalette;
  if (state.showPalette) {
    palette.innerHTML = qs.map((x, i) => {
      const cls = ['pal-btn'];
      if (answers[x.id] !== undefined) cls.push('is-done');
      if (i === idx) cls.push('is-here');
      return `<button class="${cls.join(' ')}" data-action="goto" data-arg="${i}">${i + 1}</button>`;
    }).join('');
  }

  if (!q) return;
  const picked = answers[q.id];
  const revealed = isInstant() && picked !== undefined;

  $('q-num').textContent = pad2(idx + 1);
  $('q-chapter').textContent = q.ch;
  $('q-text').textContent = q.q;

  const options = $('options');
  options.classList.toggle('is-revealed', revealed);
  options.innerHTML = q.o.map((text, i) => {
    let cls = '', mark = '';
    if (revealed) {
      if (i === q.a) { cls = 'is-right'; mark = '正解'; }
      else if (i === picked) { cls = 'is-wrong'; mark = '你的'; }
    } else if (i === picked) {
      cls = 'is-picked';
    }
    return `
      <button class="option ${cls}" data-action="pick" data-arg="${i}">
        <span class="option-badge">${LETTERS[i]}</span>
        <span class="option-text">${esc(text)}</span>
        <span class="option-mark">${mark}</span>
      </button>`;
  }).join('');

  const feedback = $('feedback');
  feedback.hidden = !revealed;
  if (revealed) {
    const ok = picked === q.a;
    feedback.className = 'feedback ' + (ok ? 'is-ok' : 'is-bad');
    feedback.textContent = ok ? '答對了。' : '正確答案為' + optionText(q, q.a);
  }
}

function renderResult() {
  const qs = quizQuestions();
  const answers = state.answers;
  const { correct, blank, wrong, score } = grade(qs, answers);
  const pass = score >= CONFIG.passScore;
  const minutes = Math.max(0, (state.endedAt - state.started) / 60000);

  $('result-mode').textContent = modeLabel(state.mode, state.chapter) + ' · 成績單';
  $('score').textContent = score;
  const badge = $('pass-badge');
  badge.textContent = pass ? '及格' : '不及格';
  badge.className = 'pass-badge ' + (pass ? 'is-pass' : 'is-fail');
  $('result-wrong-count').textContent = state.wrong.length;

  const stats = [
    { value: correct, label: '答對' },
    { value: wrong, label: '答錯', bad: true },
    { value: blank, label: '未作答' },
    { value: minutes < 1 ? '<1' : Math.round(minutes), label: '用時 / 分' },
  ];
  $('stats').innerHTML = stats.map((s) => `
    <div>
      <div class="stat-value${s.bad ? ' is-bad' : ''}">${esc(s.value)}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');

  const byChapter = new Map();
  qs.forEach((x) => {
    const m = byChapter.get(x.ch) || { total: 0, correct: 0 };
    m.total++;
    if (answers[x.id] === x.a) m.correct++;
    byChapter.set(x.ch, m);
  });
  $('breakdown').innerHTML = [...byChapter].map(([name, m]) => {
    const pct = Math.round((m.correct / m.total) * 100);
    return `
      <div>
        <div class="breakdown-head">
          <span class="breakdown-name">${esc(name)}</span>
          <span class="breakdown-label">${m.correct} / ${m.total}　${pct}%</span>
        </div>
        <div class="bar"><span class="${pct >= CONFIG.passScore ? 'is-good' : 'is-bad'}" style="width:${pct}%"></span></div>
      </div>`;
  }).join('');

  const missed = qs
    .map((x, i) => ({ q: x, n: i + 1 }))
    .filter(({ q }) => answers[q.id] !== q.a);
  $('review').hidden = !missed.length;
  $('all-correct').hidden = missed.length > 0;
  $('review').innerHTML = missed.map(({ q, n }) => `
    <div class="review-item">
      <div class="review-head">
        <span class="review-num">${pad2(n)}</span>
        <span class="review-chapter">${esc(q.ch)}</span>
      </div>
      <p class="review-text">${esc(q.q)}</p>
      <div class="review-answers">
        <div><span class="review-tag">你的</span><span class="review-yours">${
          answers[q.id] === undefined ? '未作答' : esc(optionText(q, answers[q.id]))
        }</span></div>
        <div><span class="review-tag">正解</span><span class="review-correct">${esc(optionText(q, q.a))}</span></div>
      </div>
    </div>`).join('');
}

/* ==========================================================
   事件
   ========================================================== */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = actions[el.dataset.action];
  if (action) action(el.dataset.arg);
});

document.addEventListener('keydown', (e) => {
  if (state.view !== 'quiz' || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toUpperCase();
  const i = LETTERS.includes(key) ? LETTERS.indexOf(key) : ['1', '2', '3', '4'].indexOf(key);
  if (i >= 0) {
    pick(i);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    move(1);
  } else if (e.key === 'ArrowLeft') {
    move(-1);
  }
});

// 倒數計時：時間到自動交卷
setInterval(() => {
  if (state.view !== 'quiz' || !state.deadline) return;
  renderTimer();
  if (Date.now() >= state.deadline) submit();
}, 500);

/* ==========================================================
   啟動
   ========================================================== */
async function init() {
  try {
    const res = await fetch('./questions.json');
    if (!res.ok) throw new Error(res.status);
    state.bank = await res.json();
  } catch (err) {
    console.error('題庫載入失敗', err);
    $('view-loading').textContent = '題庫載入失敗，請重新整理頁面。';
    return;
  }
  state.byId = new Map(state.bank.map((q) => [q.id, q]));
  state.chapters = buildChapters(state.bank);
  state.wrong = storage.get(STORAGE_KEYS.wrong, []);
  state.history = storage.get(STORAGE_KEYS.history, []);

  const saved = storage.get(STORAGE_KEYS.session, null);
  state.saved = saved && !(saved.deadline && saved.deadline < Date.now()) ? saved : null;

  showView('home');
}

init();
