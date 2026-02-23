'use strict';

// === Constantes ===
const SUIT_KEYS = ['spades', 'hearts', 'diamonds', 'clubs'];
const HARD_MIN_MOVES = 220;
const HARD_MAX_INITIAL_MOVES = 8;
const HARD_MIN_SOLVE_MS = 300;
const HARD_SCORE_MIN = 2;

// === Geração de deck embaralhado (plain objects, sem classe Card) ===
function shuffledDeck(numSuits) {
  const suitsToUse = SUIT_KEYS.slice(0, numSuits);
  const repeats = 104 / (13 * numSuits);
  const cards = [];
  for (let r = 0; r < repeats; r++) {
    for (let value = 1; value <= 13; value++) {
      for (const suit of suitsToUse) {
        cards.push({ suit, value });
      }
    }
  }
  // Fisher-Yates
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
  }
  return cards;
}

// === Solver (espelho de SpiderGame._runSolver, sem salvar histórico) ===

function createState(cards) {
  const tableau = Array.from({ length: 10 }, () => []);
  let idx = 0;
  for (let col = 0; col < 10; col++) {
    const num = col < 4 ? 6 : 5;
    for (let i = 0; i < num; i++) {
      tableau[col].push({ suit: cards[idx].suit, value: cards[idx].value, faceUp: i === num - 1 });
      idx++;
    }
  }
  const stock = [];
  for (let i = idx; i < cards.length; i++) {
    stock.push({ suit: cards[i].suit, value: cards[i].value, faceUp: false });
  }
  return { tableau, stock, completed: 0 };
}

function flipTop(col) {
  if (col.length > 0 && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
}

function removeSequences(state) {
  let found = true;
  while (found) {
    found = false;
    for (let c = 0; c < 10; c++) {
      const col = state.tableau[c];
      if (col.length < 13) continue;
      const s = col.length - 13;
      if (col[s].value !== 13) continue;
      const suit = col[s].suit;
      let ok = true;
      for (let i = 0; i < 13; i++) {
        const card = col[s + i];
        if (!card.faceUp || card.suit !== suit || card.value !== 13 - i) { ok = false; break; }
      }
      if (ok) { col.splice(s, 13); state.completed++; flipTop(col); found = true; break; }
    }
  }
}

function getMoves(state) {
  const moves = [];
  for (let from = 0; from < 10; from++) {
    const col = state.tableau[from];
    for (let ci = col.length - 1; ci >= 0; ci--) {
      if (!col[ci].faceUp) break;
      if (ci < col.length - 1 && (col[ci].suit !== col[ci + 1].suit || col[ci].value !== col[ci + 1].value + 1)) break;
      const card = col[ci];
      const numCards = col.length - ci;
      for (let to = 0; to < 10; to++) {
        if (from === to) continue;
        const target = state.tableau[to];
        if (target.length === 0) {
          if (ci === 0) continue;
          let score = 10 + (card.value === 13 ? 15 : 0) + (ci > 0 && !col[ci - 1].faceUp ? 40 : 0);
          moves.push({ from, to, ci, score });
        } else {
          const top = target[target.length - 1];
          if (top.value !== card.value + 1) continue;
          let score = (top.suit === card.suit ? 100 : 30) + (ci > 0 && !col[ci - 1].faceUp ? 50 : 0) + numCards * 3;
          moves.push({ from, to, ci, score });
        }
      }
    }
  }
  moves.sort((a, b) => b.score - a.score);
  return moves;
}

function deal(state) {
  for (let i = 0; i < 10 && state.stock.length > 0; i++) {
    const card = state.stock.pop();
    card.faceUp = true;
    state.tableau[i].push(card);
  }
}

function trySolve(cards, trial) {
  const state = createState(cards);
  let seed = trial * 997 + 13;
  let moveCount = 0, noProgress = 0, lastFrom = -1, lastTo = -1;
  const MAX = 1000;
  const moves = [];

  while (moveCount < MAX && state.completed < 8) {
    const before = state.completed;
    removeSequences(state);
    if (state.completed >= 8) return moves.length;
    if (state.completed > before) noProgress = 0;

    let avail = getMoves(state);

    if (avail.length === 0) {
      if (state.stock.length > 0) {
        deal(state);
        moves.push({ type: 'deal' });
        moveCount++; noProgress = 0; lastFrom = lastTo = -1;
        continue;
      }
      break;
    }

    if (lastFrom >= 0) {
      const filtered = avail.filter(m => !(m.from === lastTo && m.to === lastFrom));
      if (filtered.length > 0) avail = filtered;
    }

    let pickIdx = 0;
    if (avail.length > 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = (seed >>> 0) / 0x80000000;
      if (r < 0.6) pickIdx = 0;
      else if (r < 0.85) pickIdx = Math.min(1, avail.length - 1);
      else pickIdx = Math.min(2, avail.length - 1);
    }

    const move = avail[pickIdx];
    const willReveal = move.ci > 0 && !state.tableau[move.from][move.ci - 1].faceUp;
    state.tableau[move.to].push(...state.tableau[move.from].splice(move.ci));
    flipTop(state.tableau[move.from]);
    moves.push({ type: 'move', fromCol: move.from, cardIndex: move.ci, toCol: move.to });
    moveCount++;
    lastFrom = move.from; lastTo = move.to;

    if (willReveal) {
      noProgress = 0;
    } else if (++noProgress > 20 && state.stock.length > 0) {
      deal(state);
      moves.push({ type: 'deal' });
      moveCount++; noProgress = 0; lastFrom = lastTo = -1;
    }
  }

  return state.completed >= 8 ? moves.length : null;
}

// === Encoding de ID (espelho de SpiderGame._encodeGameId) ===

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function computeChecksum(numSuits, bytes) {
  let c = (numSuits * 131) & 0xffff;
  for (const b of bytes) c = ((c * 31) + b + 7) & 0xffff;
  return c;
}

function encodeGameId(numSuits, cards) {
  const bytes = cards.map(c => SUIT_KEYS.indexOf(c.suit) * 13 + (c.value - 1));
  const payload = bytesToBase64Url(bytes);
  const cs = computeChecksum(numSuits, bytes).toString(16).padStart(4, '0');
  return `SP1-${numSuits}-${payload}-${cs}`;
}

function countInitialMoves(cards) {
  const state = createState(cards);
  return getMoves(state).length;
}

function isHardCandidate(movesCount, initialMoves, solveMs) {
  let score = 0;
  if (movesCount >= HARD_MIN_MOVES) score++;
  if (initialMoves <= HARD_MAX_INITIAL_MOVES) score++;
  if (solveMs >= HARD_MIN_SOLVE_MS) score++;
  return score >= HARD_SCORE_MIN;
}

// === Lógica do worker ===

let paused = false;
let targetNumSuits = null;

function generate() {
  if (paused || targetNumSuits === null) {
    setTimeout(generate, 100);
    return;
  }

  const cards = shuffledDeck(targetNumSuits);
  const initialMoves = countInitialMoves(cards);
  let solvedMoves = null;
  const start = Date.now();
  for (let t = 0; t < 25 && solvedMoves === null; t++) {
    solvedMoves = trySolve(cards, t);
  }
  const solveMs = Date.now() - start;

  if (solvedMoves !== null) {
    const hard = isHardCandidate(solvedMoves, initialMoves, solveMs);
    self.postMessage({ type: 'game', numSuits: targetNumSuits, gameId: encodeGameId(targetNumSuits, cards), hard });
  }

  setTimeout(generate, 0);
}

self.onmessage = function(e) {
  const { cmd, numSuits } = e.data;
  if (cmd === 'start') {
    targetNumSuits = numSuits;
    paused = false;
    setTimeout(generate, 0);
  } else if (cmd === 'pause') {
    paused = true;
  } else if (cmd === 'resume') {
    paused = false;
  }
};
