'use strict';

const QUESTIONS_URL = 'lpi_questions.json';
const QUIZ_KEY = 'lpi-practice:quiz';
const THEME_KEY = 'lpi-practice:theme';
const EXAM_LENGTH = 40;
// The real exam allows 60 minutes for 40 questions.
const SECONDS_PER_QUESTION = 90;
const OPTION_KEYS = 'abcde';
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

const $ = id => document.getElementById(id);

const views = {
  start: $('startView'),
  quiz: $('quizView'),
  results: $('resultsView'),
};

let bank = [];       // every question from the JSON file
let byId = new Map();
let quiz = null;     // the quiz in progress, see createQuiz()
let lastResult = null;
let timerHandle = null;
let sessionStart = 0;

/* ---------- Helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable: progress just won't persist */ }
}

/* ---------- Rich text ----------
 * Question text supports a tiny subset of Markdown:
 *   `inline code`, ```fenced code blocks``` and blank lines between paragraphs.
 * Everything is inserted with textContent, so question data is never parsed as HTML.
 */

function appendInline(parent, text) {
  text.split(/`([^`]+)`/).forEach((chunk, i) => {
    if (!chunk) return;
    parent.append(i % 2 ? el('code', null, chunk) : chunk);
  });
}

function renderRich(container, text) {
  container.replaceChildren();
  text.split(/```\n?([\s\S]*?)\n?```/).forEach((part, i) => {
    if (i % 2) {
      const pre = el('pre', 'code-block');
      pre.append(el('code', null, part));
      container.append(pre);
      return;
    }
    part.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).forEach(para => {
      const p = el('p');
      appendInline(p, para);
      container.append(p);
    });
  });
}

// "(Choose two.)" is shown as a separate hint, so strip it from the prompt.
function promptText(q) {
  return q.question.replace(/\s*\(Choose \w+\.?\)/i, '');
}

function isTextQuestion(q) {
  return q.type === 'text';
}

// Options of `"code": true` questions are commands or terminal output.
function renderOption(q, option) {
  const text = el('span', 'option-text');
  if (q.code) text.append(el('code', option.includes('\n') ? 'option-code is-block' : 'option-code', option));
  else appendInline(text, option);
  return text;
}

/* ---------- Quiz state ---------- */

function createQuiz(questions) {
  return {
    items: questions.map(q => ({
      id: q.id,
      options: isTextQuestion(q) ? [] : shuffle([...q.options]),
      response: isTextQuestion(q) ? '' : [],
      flagged: false,
    })),
    current: 0,
    elapsed: 0,
  };
}

function questionOf(item) {
  return byId.get(item.id);
}

function isAnswered(item) {
  return isTextQuestion(questionOf(item)) ? item.response.trim() !== '' : item.response.length > 0;
}

function isCorrect(item) {
  const q = questionOf(item);
  if (isTextQuestion(q)) return q.answer.includes(item.response.trim());
  return item.response.length === q.answer.length && q.answer.every(a => item.response.includes(a));
}

function elapsedMs() {
  return quiz.elapsed + (sessionStart ? Date.now() - sessionStart : 0);
}

function saveQuiz() {
  if (!quiz) return;
  storageSet(QUIZ_KEY, { ...quiz, elapsed: elapsedMs() });
}

// Restore a saved quiz, dropping it if the question bank changed underneath it.
function loadSavedQuiz() {
  if (!bank.length) return null; // can't validate without the bank; keep whatever is saved
  const saved = storageGet(QUIZ_KEY);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) return null;

  const valid = saved.items.every(item => {
    const q = byId.get(item.id);
    if (!q) return false;
    if (isTextQuestion(q)) return typeof item.response === 'string';
    return Array.isArray(item.options) && Array.isArray(item.response)
      && item.options.length === q.options.length
      && item.options.every(o => q.options.includes(o));
  });
  if (!valid) {
    storageSet(QUIZ_KEY, null);
    return null;
  }

  return {
    items: saved.items,
    current: Math.min(Math.max(0, saved.current | 0), saved.items.length - 1),
    elapsed: Number(saved.elapsed) || 0,
  };
}

/* ---------- Views ---------- */

function showView(name) {
  Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
  $('quizStatus').hidden = name !== 'quiz';
  $('progress').hidden = name !== 'quiz';
  window.scrollTo(0, 0);
}

function showStart() {
  stopTimer();
  const saved = loadSavedQuiz();
  $('resumeCard').hidden = !saved;
  $('replaceNote').hidden = !saved;
  if (saved) {
    const answered = saved.items.filter(isAnswered).length;
    $('resumeMeta').textContent =
      `${answered} of ${plural(saved.items.length, 'question')} answered, ${formatTime(saved.elapsed)} spent`;
  }
  showView('start');
}

function startQuiz(questions) {
  quiz = createQuiz(questions);
  saveQuiz();
  enterQuiz();
}

function enterQuiz() {
  showView('quiz');
  buildQuestionMap();
  renderQuestion();
  startTimer();
}

/* ---------- Timer ---------- */

function startTimer() {
  stopTimer();
  sessionStart = Date.now();
  tick();
  timerHandle = setInterval(tick, 1000);
}

function stopTimer() {
  if (quiz && sessionStart) quiz.elapsed = elapsedMs();
  sessionStart = 0;
  clearInterval(timerHandle);
  timerHandle = null;
}

function tick() {
  const ms = elapsedMs();
  const timer = $('timer');
  timer.textContent = formatTime(ms);
  const pace = quiz.items.length * SECONDS_PER_QUESTION * 1000;
  const over = ms > pace;
  timer.classList.toggle('is-over', over);
  timer.title = over
    ? `Past real exam pace (${formatTime(pace)} for ${plural(quiz.items.length, 'question')})`
    : 'Time spent on this quiz';
}

/* ---------- Question rendering ---------- */

function renderQuestion() {
  const item = quiz.items[quiz.current];
  const q = questionOf(item);
  const total = quiz.items.length;

  $('questionNumber').textContent = `Question ${quiz.current + 1} of ${total}`;
  renderRich($('questionText'), promptText(q));
  renderFlag(item);

  const hint = $('questionHint');
  const answers = $('answers');
  answers.replaceChildren();

  if (isTextQuestion(q)) {
    hint.textContent = 'Type your answer, then press Enter to continue';
    const input = el('input', 'text-answer');
    Object.assign(input, {
      type: 'text',
      value: item.response,
      autocomplete: 'off',
      spellcheck: false,
    });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-labelledby', 'questionText');
    input.addEventListener('input', () => {
      item.response = input.value;
      updateProgress();
      saveQuiz();
    });
    answers.append(input);
  } else {
    const multi = q.answer.length > 1;
    hint.textContent = multi ? `Choose ${NUMBER_WORDS[q.answer.length] || q.answer.length} answers` : 'Choose one answer';

    const group = el('div', `options${multi ? ' is-multi' : ''}`);
    group.setAttribute('role', multi ? 'group' : 'radiogroup');
    group.setAttribute('aria-labelledby', 'questionText');

    item.options.forEach((option, i) => {
      const label = el('label', 'option');
      const input = el('input');
      input.type = multi ? 'checkbox' : 'radio';
      input.name = 'answer';
      input.value = option;
      input.checked = item.response.includes(option);
      input.addEventListener('change', () => {
        const inputs = [...group.querySelectorAll('input')];
        item.response = item.options.filter((_, j) => inputs[j].checked);
        updateProgress();
        saveQuiz();
      });

      const key = el('span', 'option-key', OPTION_KEYS[i]?.toUpperCase() ?? String(i + 1));
      key.setAttribute('aria-hidden', 'true');
      label.append(input, key, renderOption(q, option));
      group.append(label);
    });
    answers.append(group);
  }

  $('prevBtn').disabled = quiz.current === 0;
  const last = quiz.current === total - 1;
  $('nextBtn').textContent = last ? 'Submit answers' : 'Next';

  $('announcer').textContent = `Question ${quiz.current + 1} of ${total}`;
  updateProgress();
}

function renderFlag(item) {
  const btn = $('flagBtn');
  btn.setAttribute('aria-pressed', String(item.flagged));
  $('flagLabel').textContent = item.flagged ? 'Flagged' : 'Flag for review';
}

function buildQuestionMap() {
  const map = $('questionMap');
  map.replaceChildren();
  quiz.items.forEach((_, i) => {
    const li = el('li');
    const btn = el('button', 'qmap-cell', String(i + 1));
    btn.type = 'button';
    btn.addEventListener('click', () => goTo(i));
    li.append(btn);
    map.append(li);
  });
}

function updateProgress() {
  const answered = quiz.items.filter(isAnswered).length;
  const total = quiz.items.length;
  $('progressBar').style.width = `${(answered / total) * 100}%`;
  $('answeredCount').textContent = `${answered} of ${total} answered`;

  $('questionMap').querySelectorAll('.qmap-cell').forEach((btn, i) => {
    const item = quiz.items[i];
    const answeredItem = isAnswered(item);
    btn.classList.toggle('is-answered', answeredItem);
    btn.classList.toggle('is-flagged', item.flagged);
    if (i === quiz.current) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
    const state = [answeredItem ? 'answered' : 'not answered', item.flagged && 'flagged'].filter(Boolean);
    btn.setAttribute('aria-label', `Question ${i + 1}, ${state.join(', ')}`);
  });
}

/* ---------- Navigation ---------- */

function focusAnswers() {
  const answers = $('answers');
  (answers.querySelector('input:checked') || answers.querySelector('input'))?.focus({ preventScroll: true });
}

function goTo(index, { keyboard = false } = {}) {
  if (index < 0 || index >= quiz.items.length) return;
  const focusWasInAnswers = $('answers').contains(document.activeElement);
  quiz.current = index;
  renderQuestion();
  saveQuiz();
  // Keep keyboard users in the answer list as they move between questions.
  if (keyboard || focusWasInAnswers) focusAnswers();
  const headerBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
  if ($('questionCard').getBoundingClientRect().top < headerBottom) {
    $('questionCard').scrollIntoView({ block: 'start' });
  }
}

function next(options) {
  if (quiz.current < quiz.items.length - 1) goTo(quiz.current + 1, options);
  else requestSubmit();
}

function toggleFlag() {
  const item = quiz.items[quiz.current];
  item.flagged = !item.flagged;
  renderFlag(item);
  updateProgress();
  saveQuiz();
}

function chooseOption(index) {
  const inputs = $('answers').querySelectorAll('.option input');
  const input = inputs[index];
  if (!input) return;
  input.checked = input.type === 'checkbox' ? !input.checked : true;
  input.dispatchEvent(new Event('change'));
  input.focus();
}

/* ---------- Submitting ---------- */

function requestSubmit() {
  const unanswered = quiz.items.filter(item => !isAnswered(item)).length;
  const flagged = quiz.items.filter(item => item.flagged).length;
  if (!unanswered && !flagged) {
    submit();
    return;
  }
  const notes = [];
  if (unanswered) notes.push(`${plural(unanswered, 'question')} ${unanswered === 1 ? 'is' : 'are'} unanswered and will count as wrong.`);
  if (flagged) notes.push(`${plural(flagged, 'question')} ${flagged === 1 ? 'is' : 'are'} still flagged for review.`);
  $('submitDialogText').textContent = notes.join(' ');
  const dialog = $('submitDialog');
  dialog.returnValue = '';
  dialog.showModal();
}

function submit() {
  stopTimer();
  lastResult = {
    items: quiz.items.map(item => ({ ...item, correct: isCorrect(item), answered: isAnswered(item) })),
    elapsed: quiz.elapsed,
  };
  quiz = null;
  storageSet(QUIZ_KEY, null);
  renderResults();
}

/* ---------- Results ---------- */

function renderResults() {
  const { items, elapsed } = lastResult;
  const total = items.length;
  const correct = items.filter(i => i.correct).length;
  const unanswered = items.filter(i => !i.answered).length;
  const wrong = total - correct - unanswered;
  const missed = total - correct;
  const percent = Math.round((correct / total) * 100);

  $('scoreTitle').textContent = `You scored ${percent}%`;
  $('scoreSummary').textContent = missed
    ? `${correct} of ${total} correct. Review the ${plural(missed, 'question')} you missed below, then retry them.`
    : `${correct} of ${total} correct. Every answer was right.`;

  const stats = $('scoreStats');
  stats.replaceChildren();
  [
    ['Correct', correct, 'is-correct'],
    ['Wrong', wrong, 'is-wrong'],
    ['Unanswered', unanswered, ''],
    ['Time', formatTime(elapsed), ''],
  ].forEach(([label, value, cls]) => {
    const row = el('div', `stat ${cls}`.trim());
    row.append(el('dt', null, label), el('dd', null, String(value)));
    stats.append(row);
  });

  const retry = $('retryBtn');
  retry.hidden = missed === 0;
  retry.textContent = `Retry ${plural(missed, 'missed question')}`;

  const map = $('resultMap');
  map.replaceChildren();
  items.forEach((item, i) => {
    const li = el('li');
    const status = item.correct ? 'correct' : item.answered ? 'wrong' : 'unanswered';
    const btn = el('button', `qmap-cell is-${status}${item.flagged ? ' is-flagged' : ''}`, String(i + 1));
    btn.type = 'button';
    btn.setAttribute('aria-label', `Question ${i + 1}, ${status}${item.flagged ? ', flagged' : ''}`);
    btn.addEventListener('click', () => {
      setFilter('all');
      const target = $(`review-${i}`);
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
    });
    li.append(btn);
    map.append(li);
  });

  renderReviewList();
  setFilter('all');
  showView('results');
  $('scoreTitle').focus();
}

function renderReviewList() {
  const list = $('reviewList');
  list.replaceChildren();

  lastResult.items.forEach((item, i) => {
    const q = questionOf(item);
    const status = item.correct ? 'correct' : item.answered ? 'wrong' : 'unanswered';

    const li = el('li', `review-item is-${status}`);
    li.id = `review-${i}`;
    li.tabIndex = -1;
    li.dataset.missed = String(!item.correct);
    li.dataset.flagged = String(item.flagged);

    const head = el('div', 'review-item-head');
    head.append(el('h3', 'review-number', `Question ${i + 1}`));
    const tags = el('div', 'tags');
    tags.append(el('span', `tag tag-${status}`, { correct: 'Correct', wrong: 'Wrong', unanswered: 'Unanswered' }[status]));
    if (item.flagged) tags.append(el('span', 'tag tag-flagged', 'Flagged'));
    head.append(tags);

    const prompt = el('div', 'prompt');
    renderRich(prompt, q.question);
    li.append(head, prompt);

    if (isTextQuestion(q)) {
      const dl = el('dl', 'text-review');
      const yours = el('div');
      const yourValue = el('dd');
      if (item.answered) yourValue.append(el('code', null, item.response.trim()));
      else yourValue.textContent = 'No answer';
      yours.append(el('dt', null, 'Your answer'), yourValue);
      const expected = el('div');
      const expectedValue = el('dd');
      expectedValue.append(el('code', null, q.answer[0]));
      expected.append(el('dt', null, 'Correct answer'), expectedValue);
      dl.append(yours, expected);
      if (q.answer.length > 1) {
        const also = el('div');
        const alsoValue = el('dd');
        q.answer.slice(1).forEach((a, j) => {
          if (j) alsoValue.append(', ');
          alsoValue.append(el('code', null, a));
        });
        also.append(el('dt', null, 'Also accepted'), alsoValue);
        dl.append(also);
      }
      li.append(dl);
    } else {
      const options = el('ul', 'review-options');
      item.options.forEach(option => {
        const isAnswer = q.answer.includes(option);
        const chosen = item.response.includes(option);
        const row = el('li', 'review-option');
        if (isAnswer) row.classList.add('is-answer');
        if (chosen) row.classList.add('is-chosen');
        if (chosen && !isAnswer) row.classList.add('is-mistake');

        const notes = [];
        if (chosen) notes.push('Your answer');
        if (isAnswer) notes.push('Correct answer');
        const note = el('span', 'review-note', notes.join(', '));

        row.append(renderOption(q, option), note);
        options.append(row);
      });
      li.append(options);
    }

    list.append(li);
  });
}

function setFilter(filter) {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
  });
  let shown = 0;
  $('reviewList').querySelectorAll('.review-item').forEach(li => {
    const visible = filter === 'all' || li.dataset[filter] === 'true';
    li.hidden = !visible;
    if (visible) shown++;
  });
  const empty = $('reviewEmpty');
  empty.hidden = shown > 0;
  empty.textContent = filter === 'missed'
    ? 'No missed questions. Every answer was right.'
    : 'No flagged questions. Use “Flag for review” during a quiz to mark questions you want to revisit.';
}

/* ---------- Theme ---------- */

function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function updateThemeButton() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  $('themeBtn').setAttribute('aria-label', `Switch to ${next} theme`);
  $('themeBtn').title = `Switch to ${next} theme`;
}

/* ---------- Events ---------- */

$('start40').addEventListener('click', () => startQuiz(shuffle([...bank]).slice(0, EXAM_LENGTH)));
$('startAll').addEventListener('click', () => startQuiz(shuffle([...bank])));
$('resumeBtn').addEventListener('click', () => {
  quiz = loadSavedQuiz();
  if (quiz) enterQuiz();
  else showStart();
});

$('prevBtn').addEventListener('click', () => goTo(quiz.current - 1));
$('nextBtn').addEventListener('click', next);
$('flagBtn').addEventListener('click', toggleFlag);
$('submitBtn').addEventListener('click', requestSubmit);
$('exitBtn').addEventListener('click', () => {
  stopTimer();
  saveQuiz();
  quiz = null;
  showStart();
});

$('submitDialog').addEventListener('close', () => {
  if ($('submitDialog').returnValue === 'submit') submit();
});

$('retryBtn').addEventListener('click', () => {
  const missed = lastResult.items.filter(i => !i.correct).map(i => byId.get(i.id));
  startQuiz(shuffle(missed));
});
$('newQuizBtn').addEventListener('click', showStart);

document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter));
});

$('themeBtn').addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* not persisted */ }
  updateThemeButton();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeButton);

document.addEventListener('keydown', e => {
  if (!quiz || views.quiz.hidden || $('submitDialog').open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const target = e.target;
  const typing = target.matches('input[type="text"], textarea');
  const onButton = target.matches('button');

  if (e.key === 'Enter') {
    if (onButton) return; // let the focused button do its own thing
    e.preventDefault();
    next({ keyboard: true });
    return;
  }
  if (typing) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // Up/Down still move between options; Left/Right move between questions.
    e.preventDefault();
    goTo(quiz.current + (e.key === 'ArrowRight' ? 1 : -1), { keyboard: true });
    return;
  }

  const key = e.key.toLowerCase();
  if (key === 'f') {
    e.preventDefault();
    toggleFlag();
    return;
  }
  const optionIndex = OPTION_KEYS.indexOf(key);
  if (optionIndex !== -1 && e.key.length === 1) {
    e.preventDefault();
    chooseOption(optionIndex);
  }
});

// Persist the clock when the tab is hidden or closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveQuiz();
});

/* ---------- Boot ---------- */

async function init() {
  updateThemeButton();
  try {
    const response = await fetch(QUESTIONS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bank = await response.json();
    byId = new Map(bank.map(q => [q.id, q]));
  } catch (err) {
    const error = $('loadError');
    error.hidden = false;
    error.textContent = location.protocol === 'file:'
      ? 'The question bank can’t be loaded when the page is opened straight from disk. '
        + 'Serve the folder instead, for example with “python3 -m http.server”, then open http://localhost:8000.'
      : `The question bank (${QUESTIONS_URL}) didn’t load: ${err.message}. Reload the page to try again.`;
    showStart();
    return;
  }

  $('bankCount').textContent = bank.length;
  $('start40').disabled = bank.length === 0;
  $('startAll').disabled = bank.length === 0;
  if (bank.length <= EXAM_LENGTH) $('start40').hidden = true;
  showStart();
}

init();
