'use strict';

const SUIT_KEYS = ['spades', 'hearts', 'diamonds', 'clubs'];

let cancelRequested = false;
let activeRequestId = 0;

function copyState(state) {
  return {
    tableau: state.tableau.map(col => col.map(c => ({ suit: c.suit, value: c.value, faceUp: c.faceUp }))),
    stock: state.stock.map(c => ({ suit: c.suit, value: c.value, faceUp: c.faceUp })),
    completed: state.completed
  };
}

function flipTop(col) {
  if (col.length > 0 && !col[col.length - 1].faceUp) {
    col[col.length - 1].faceUp = true;
  }
}

function removeSequences(state) {
  let found = true;
  while (found) {
    if (cancelRequested) return;
    found = false;
    for (let c = 0; c < 10; c++) {
      const col = state.tableau[c];
      if (col.length < 13) continue;
      const start = col.length - 13;
      if (col[start].value !== 13) continue;
      const suit = col[start].suit;
      let valid = true;
      for (let i = 0; i < 13; i++) {
        const card = col[start + i];
        if (!card.faceUp || card.suit !== suit || card.value !== 13 - i) {
          valid = false;
          break;
        }
      }
      if (valid) {
        col.splice(start, 13);
        state.completed++;
        flipTop(col);
        found = true;
        break;
      }
    }
  }
}

function getMoves(state) {
  const moves = [];
  const { tableau } = state;
  for (let from = 0; from < 10; from++) {
    const col = tableau[from];
    for (let ci = col.length - 1; ci >= 0; ci--) {
      if (!col[ci].faceUp) break;
      if (ci < col.length - 1) {
        if (col[ci].suit !== col[ci + 1].suit || col[ci].value !== col[ci + 1].value + 1) break;
      }
      const card = col[ci];
      const numCards = col.length - ci;
      for (let to = 0; to < 10; to++) {
        if (from === to) continue;
        const target = tableau[to];
        if (target.length === 0) {
          if (ci === 0) continue;
          let score = 10;
          if (card.value === 13) score += 15;
          if (ci > 0 && !col[ci - 1].faceUp) score += 40;
          moves.push({ from, to, ci, score });
        } else {
          const top = target[target.length - 1];
          if (top.value !== card.value + 1) continue;
          let score = 0;
          if (top.suit === card.suit) {
            score += 100;
          } else {
            score += 30;
          }
          if (ci > 0 && !col[ci - 1].faceUp) score += 50;
          score += numCards * 3;
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

function runSolver(state, trial, maxMoves) {
  const moves = [];
  let seed = trial * 997 + 13;
  let moveCount = 0;
  let noProgressCount = 0;
  let lastFrom = -1, lastTo = -1;

  while (moveCount < maxMoves && state.completed < 8) {
    if (cancelRequested) return null;
    const completedBefore = state.completed;
    removeSequences(state);
    if (cancelRequested) return null;
    if (state.completed >= 8) return moves;
    if (state.completed > completedBefore) noProgressCount = 0;

    let availMoves = getMoves(state);

    if (availMoves.length === 0) {
      if (state.stock.length > 0) {
        deal(state);
        moves.push({ type: 'deal' });
        moveCount++;
        noProgressCount = 0;
        lastFrom = lastTo = -1;
        continue;
      }
      break;
    }

    if (lastFrom >= 0) {
      const filtered = availMoves.filter(m => !(m.from === lastTo && m.to === lastFrom));
      if (filtered.length > 0) availMoves = filtered;
    }

    let pickIdx = 0;
    if (availMoves.length > 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = (seed >>> 0) / 0x80000000;
      if (r < 0.6) pickIdx = 0;
      else if (r < 0.85) pickIdx = Math.min(1, availMoves.length - 1);
      else pickIdx = Math.min(2, availMoves.length - 1);
    }

    const move = availMoves[pickIdx];
    const willReveal = move.ci > 0 && !state.tableau[move.from][move.ci - 1].faceUp;

    state.tableau[move.to].push(...state.tableau[move.from].splice(move.ci));
    flipTop(state.tableau[move.from]);

    moves.push({ type: 'move', fromCol: move.from, cardIndex: move.ci, toCol: move.to });
    moveCount++;
    lastFrom = move.from;
    lastTo = move.to;

    if (willReveal) {
      noProgressCount = 0;
    } else {
      noProgressCount++;
      if (noProgressCount > 20 && state.stock.length > 0) {
        deal(state);
        moves.push({ type: 'deal' });
        moveCount++;
        noProgressCount = 0;
        lastFrom = lastTo = -1;
      }
    }
  }

  return state.completed >= 8 ? moves : null;
}

function hashState(state) {
  let h = '';
  for (let c = 0; c < 10; c++) {
    for (const card of state.tableau[c]) {
      h += String.fromCharCode(33 + SUIT_KEYS.indexOf(card.suit) * 26 + (card.value - 1) * 2 + (card.faceUp ? 1 : 0));
    }
    h += '|';
  }
  h += state.stock.length + ',' + state.completed;
  return h;
}

function backtrackMoves(state, maxBranch) {
  const cardMoves = getMoves(state);
  const moves = [];
  const limit = Math.min(maxBranch, cardMoves.length);
  for (let i = 0; i < limit; i++) {
    const m = cardMoves[i];
    moves.push({ type: 'move', fromCol: m.from, cardIndex: m.ci, toCol: m.to });
  }
  if (state.stock.length > 0) moves.push({ type: 'deal' });
  return moves;
}

function solveWithBacktracking(initialState, timeLimitMs) {
  const deadline = Date.now() + timeLimitMs;
  const visited = new Set();
  const MAX_BRANCH = 3;

  removeSequences(initialState);
  if (cancelRequested) return null;
  if (initialState.completed >= 8) return [];

  const initHash = hashState(initialState);
  visited.add(initHash);

  const initMoves = backtrackMoves(initialState, MAX_BRANCH);
  if (initMoves.length === 0) return null;

  const stack = [{ state: initialState, availMoves: initMoves, tryIdx: 0, move: null }];
  let iterations = 0;

  while (stack.length > 0) {
    if (cancelRequested) return null;
    if (++iterations % 2000 === 0 && Date.now() > deadline) return null;

    const frame = stack[stack.length - 1];

    if (frame.tryIdx >= frame.availMoves.length) {
      stack.pop();
      continue;
    }

    const move = frame.availMoves[frame.tryIdx++];

    const newState = copyState(frame.state);

    if (move.type === 'deal') {
      deal(newState);
    } else {
      newState.tableau[move.toCol].push(...newState.tableau[move.fromCol].splice(move.cardIndex));
      flipTop(newState.tableau[move.fromCol]);
    }

    removeSequences(newState);
    if (cancelRequested) return null;
    if (newState.completed >= 8) {
      const solution = [];
      for (let i = 1; i < stack.length; i++) solution.push(stack[i].move);
      solution.push(move);
      return solution;
    }

    const hash = hashState(newState);
    if (visited.has(hash)) continue;
    visited.add(hash);

    const newMoves = backtrackMoves(newState, MAX_BRANCH);
    if (newMoves.length === 0) continue;

    stack.push({ state: newState, availMoves: newMoves, tryIdx: 0, move });
  }

  return null;
}

function findSolution(state, greedyTrials, greedyMaxMoves, backtrackTimeLimitMs) {
  for (let t = 0; t < greedyTrials; t++) {
    if (cancelRequested) return null;
    const result = runSolver(copyState(state), t, greedyMaxMoves);
    if (result !== null) return result;
  }
  if (cancelRequested) return null;
  return solveWithBacktracking(copyState(state), backtrackTimeLimitMs);
}

self.onmessage = function(e) {
  const data = e.data || {};
  if (data.cmd === 'cancel') {
    if (data.requestId === activeRequestId) cancelRequested = true;
    return;
  }
  if (data.cmd !== 'solve') return;

  cancelRequested = false;
  activeRequestId = data.requestId || 0;

  try {
    const solution = findSolution(
      data.state,
      data.greedyTrials || 300,
      data.greedyMaxMoves || 2000,
      data.backtrackTimeLimitMs || 30000
    );

    if (cancelRequested) {
      self.postMessage({ type: 'cancelled', requestId: activeRequestId });
      return;
    }

    if (solution) {
      self.postMessage({ type: 'solution', requestId: activeRequestId, solution });
    } else {
      self.postMessage({ type: 'nosolution', requestId: activeRequestId });
    }
  } catch (err) {
    self.postMessage({ type: 'error', requestId: activeRequestId, message: err && err.message ? err.message : 'Erro no solver' });
  }
};
