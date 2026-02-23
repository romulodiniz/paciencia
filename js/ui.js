// === Estado Global ===
const game = new SpiderGame();
const stats = new Stats();
let currentStatsTab = 1;
let timerUpdateInterval = null;
let hintTimeout = null;

// === Auto-Solve State ===
let autoSolveActive = false;
let autoSolveTimeout = null;
let autoSolvePending = false;
let solverWorker = null;
let solverRequestId = 0;
let currentSolveRequestId = 0;
const SOLVER_WORKER_SOURCE = `'use strict';

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
`;

const POOL_MIN_START = 100;
const POOL_FILE_MIN = 10;
const POOL_FILE_MAX = 10000;
let poolWaitInterval = null;
let pendingStart = null;
let gameActive = false;

// Preaquecer pool em background antes da escolha do usuário
setTimeout(() => {
  prewarmPools();
}, 0);

// === Drag & Drop State ===
let dragState = null; // { fromCol, cardIndex, cards, ghost, offsetX, offsetY }
let justDragged = false;

// === Inicialização ===
function startGame(numSuits) {
  stopAutoSolve();
  cancelSolverSearch(true);
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');

  showToast('Iniciando jogo');

  ensurePoolMinAndStart(numSuits);
}

function startGameFromId() {
  const idInput = document.getElementById('deal-id-input');
  const dealId = idInput ? idInput.value.trim() : '';
  if (!dealId) {
    showToast('Informe um ID de jogo');
    return;
  }

  cancelSolverSearch(true);
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');

  showToast('Iniciando jogo');

  setTimeout(() => {
    const result = game.newGameFromId(dealId);
    if (!result.ok) {
      document.getElementById('game-screen').classList.add('hidden');
      document.getElementById('menu-screen').classList.remove('hidden');
      showToast(`ID inválido: ${result.error}`);
      return;
    }

    stats.recordGameStart(game.numSuits);
    render();
    startTimerUpdate();
    gameActive = true;
    updateResumeButton();
    if (idInput) idInput.value = '';
  }, 50);
}

function showMenu() {
  stopAutoSolve();
  cancelSolverSearch(true);
  cancelPoolWait(true);
  game.pauseTimer();
  stopTimerUpdate();
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  closeAllModals();
  updateResumeButton();
}

function confirmNewGame() {
  closeAllModals();
  startGame(game.numSuits);
}

function restartGame() {
  stopAutoSolve();
  cancelSolverSearch(true);
  cancelPoolWait(true);
  closeAllModals();
  game.restartGame();
  render();
  startTimerUpdate();
  showToast('Jogo reiniciado');
  gameActive = true;
  updateResumeButton();
}

function resumeGame() {
  if (!gameActive) return;
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  game.resumeTimer();
  render();
  startTimerUpdate();
}

function copyGameId() {
  if (!game.gameId) {
    showToast('ID da partida indisponível');
    return;
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(game.gameId)
      .then(() => showToast('ID copiado'))
      .catch(() => copyGameIdFallback(game.gameId));
    return;
  }

  copyGameIdFallback(game.gameId);
}

function copyGameIdFallback(gameId) {
  const ta = document.createElement('textarea');
  ta.value = gameId;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();

  const copied = document.execCommand('copy');
  ta.remove();

  if (copied) {
    showToast('ID copiado');
  } else {
    showToast('Não foi possível copiar o ID');
  }
}

// === Timer ===
function startTimerUpdate() {
  stopTimerUpdate();
  timerUpdateInterval = setInterval(() => {
    document.getElementById('timer').textContent = game.getElapsedFormatted();
  }, 1000);
}

function stopTimerUpdate() {
  if (timerUpdateInterval) {
    clearInterval(timerUpdateInterval);
    timerUpdateInterval = null;
  }
}

// === Renderização Principal ===
function render() {
  renderTableau();
  renderTopBar();
}

function renderTopBar() {
  document.getElementById('score').textContent = game.score;
  document.getElementById('moves').textContent = game.moves;
  document.getElementById('timer').textContent = game.getElapsedFormatted();

  // Sequências completas
  const completedArea = document.getElementById('completed-area');
  completedArea.innerHTML = '';
  for (let i = 0; i < game.completed.length; i++) {
    const pile = document.createElement('div');
    pile.className = 'completed-pile';
    const suit = game.completed[i][0].suit;
    pile.textContent = SUITS[suit].symbol;
    pile.style.color = SUITS[suit].color === 'red' ? '#d32f2f' : '#fff';
    completedArea.appendChild(pile);
  }

  // Estoque
  const stockArea = document.getElementById('stock-area');
  stockArea.innerHTML = '';
  if (game.stock.length > 0) {
    stockArea.classList.add('has-cards');
    const count = document.createElement('span');
    count.className = 'stock-count';
    count.textContent = Math.ceil(game.stock.length / 10);
    stockArea.appendChild(count);
  } else {
    stockArea.classList.remove('has-cards');
  }
}

function renderTableau() {
  const tableauEl = document.getElementById('tableau');
  tableauEl.innerHTML = '';

  for (let colIdx = 0; colIdx < 10; colIdx++) {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.col = colIdx;

    const col = game.tableau[colIdx];

    if (col.length === 0) {
      // Coluna vazia — área de drop
      colEl.style.minHeight = '120px';
    }

    for (let cardIdx = 0; cardIdx < col.length; cardIdx++) {
      const card = col[cardIdx];
      const cardEl = createCardElement(card, colIdx, cardIdx);
      // Empilhamento: cartas viradas para baixo = 18px, viradas para cima = 28px
      const offset = calculateCardOffset(col, cardIdx);
      cardEl.style.top = offset + 'px';
      cardEl.style.zIndex = cardIdx;
      colEl.appendChild(cardEl);
    }

    // Ajustar altura mínima da coluna com base nas cartas
    if (col.length > 0) {
      const lastOffset = calculateCardOffset(col, col.length - 1);
      const cardHeight = getCardHeight();
      colEl.style.minHeight = (lastOffset + cardHeight + 10) + 'px';
    }

    // Drop events na coluna
    colEl.addEventListener('dragover', handleDragOver);
    colEl.addEventListener('drop', handleDrop);
    colEl.addEventListener('dragenter', handleDragEnter);
    colEl.addEventListener('dragleave', handleDragLeave);

    tableauEl.appendChild(colEl);
  }
}

function getCardHeight() {
  // Calcular baseado na largura real da coluna (aspect-ratio 5:6)
  const col = document.querySelector('.column');
  if (col) {
    const colWidth = col.offsetWidth;
    return Math.max(colWidth * 6 / 5, 98);
  }
  return window.innerWidth <= 500 ? 60 : (window.innerWidth <= 800 ? 75 : 98);
}

function calculateCardOffset(col, cardIdx) {
  const isSmall = window.innerWidth <= 500;
  let offset = 0;
  for (let i = 0; i < cardIdx; i++) {
    if (isSmall) {
      offset += col[i].faceUp ? 26 : 8;
    } else {
      offset += col[i].faceUp ? 38 : 12;
    }
  }
  return offset;
}

function createCardElement(card, colIdx, cardIdx) {
  const el = document.createElement('div');
  el.className = 'card ' + (card.faceUp ? 'card-face-up' : 'card-face-down');
  el.dataset.col = colIdx;
  el.dataset.cardIdx = cardIdx;
  el.dataset.cardId = card.id;

  if (card.faceUp) {
    el.classList.add(card.color === 'red' ? 'card-red' : 'card-black');

    el.innerHTML = `
      <div class="card-corner card-corner-top">
        <span class="card-value">${card.displayValue}</span>
        <span class="card-suit-small">${card.symbol}</span>
      </div>
      <div class="card-center">${card.symbol}</div>
    `;

    // Drag events
    if (game.canPickUp(colIdx, cardIdx)) {
      el.draggable = true;
      el.addEventListener('dragstart', handleDragStart);
      el.addEventListener('dragend', handleDragEnd);
      el.style.cursor = 'grab';
    }

    // Click para auto-mover
    el.addEventListener('click', () => handleCardClick(colIdx, cardIdx));
  }

  return el;
}

// === Drag & Drop ===
function handleDragStart(e) {
  if (autoSolveActive || autoSolvePending) {
    e.preventDefault();
    return;
  }

  const colIdx = parseInt(e.target.closest('.card').dataset.col);
  const cardIdx = parseInt(e.target.closest('.card').dataset.cardIdx);

  if (!game.canPickUp(colIdx, cardIdx)) {
    e.preventDefault();
    return;
  }

  dragState = { fromCol: colIdx, cardIndex: cardIdx };

  // Adicionar dados ao drag
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `${colIdx},${cardIdx}`);

  // Marcar cartas sendo arrastadas
  const col = game.tableau[colIdx];
  for (let i = cardIdx; i < col.length; i++) {
    const cardEl = document.querySelector(`.card[data-col="${colIdx}"][data-card-idx="${i}"]`);
    if (cardEl) {
      cardEl.classList.add('dragging');
    }
  }

  // Criar ghost customizado
  const ghost = createDragGhost(colIdx, cardIdx);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 40, 20);

  // Remover ghost após início do drag
  requestAnimationFrame(() => {
    if (ghost.parentNode) ghost.remove();
  });
}

function createDragGhost(colIdx, cardIdx) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.style.position = 'absolute';
  ghost.style.top = '-9999px';
  ghost.style.left = '-9999px';

  const col = game.tableau[colIdx];
  for (let i = cardIdx; i < col.length; i++) {
    const card = col[i];
    const cardEl = document.createElement('div');
    cardEl.className = `card card-face-up card-${card.color === 'red' ? 'red' : 'black'}`;
    cardEl.style.width = '80px';
    cardEl.style.height = '110px';
    cardEl.style.marginTop = i > cardIdx ? '-85px' : '0';
    cardEl.style.padding = '4px 6px';
    cardEl.innerHTML = `
      <div class="card-corner card-corner-top" style="font-size:0.85rem">
        <span class="card-value">${card.displayValue}</span>
        <span class="card-suit-small">${card.symbol}</span>
      </div>
      <div class="card-center" style="font-size:2rem">${card.symbol}</div>
    `;
    ghost.appendChild(cardEl);
  }

  return ghost;
}

function handleDragEnd(e) {
  // Remover estilo de drag de todas as cartas
  document.querySelectorAll('.card.dragging').forEach(el => {
    el.classList.remove('dragging');
  });
  // Remover highlight das colunas
  document.querySelectorAll('.column.drop-target').forEach(el => {
    el.classList.remove('drop-target');
  });
  dragState = null;
  // Evitar que o click dispare após um drag
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  const colEl = e.target.closest('.column');
  if (colEl && dragState) {
    const toCol = parseInt(colEl.dataset.col);
    if (game.canMove(dragState.fromCol, dragState.cardIndex, toCol)) {
      colEl.classList.add('drop-target');
    }
  }
}

function handleDragLeave(e) {
  const colEl = e.target.closest('.column');
  if (colEl) {
    // Verificar se realmente saiu da coluna
    const rect = colEl.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) {
      colEl.classList.remove('drop-target');
    }
  }
}

function handleDrop(e) {
  e.preventDefault();
  const colEl = e.target.closest('.column');
  if (!colEl || !dragState) return;

  const toCol = parseInt(colEl.dataset.col);
  colEl.classList.remove('drop-target');

  const result = game.moveCards(dragState.fromCol, dragState.cardIndex, toCol);
  if (result && result.moved) {
    render();
    if (result.completedSequence) {
      showToast('Sequência completa! +100 pontos');
      if (game.checkWin()) {
        handleWin();
      }
    }
  }

  dragState = null;
}

// === Click Auto-Move ===
function handleCardClick(colIdx, cardIdx) {
  // Ignorar click após drag ou durante auto-solve
  if (justDragged || autoSolveActive || autoSolvePending) return;
  // Tentar mover para a melhor coluna disponível
  if (!game.canPickUp(colIdx, cardIdx)) return;

  const movingCard = game.tableau[colIdx][cardIdx];

  // Prioridade 1: Mesmo naipe
  for (let to = 0; to < 10; to++) {
    if (game.canMove(colIdx, cardIdx, to)) {
      const targetCol = game.tableau[to];
      if (targetCol.length > 0 && targetCol[targetCol.length - 1].suit === movingCard.suit) {
        const result = game.moveCards(colIdx, cardIdx, to);
        if (result && result.moved) {
          render();
          checkAfterMove(result);
          return;
        }
      }
    }
  }

  // Prioridade 2: Qualquer coluna com carta (não vazia)
  for (let to = 0; to < 10; to++) {
    if (game.canMove(colIdx, cardIdx, to) && game.tableau[to].length > 0) {
      const result = game.moveCards(colIdx, cardIdx, to);
      if (result && result.moved) {
        render();
        checkAfterMove(result);
        return;
      }
    }
  }

  // Prioridade 3: Coluna vazia
  for (let to = 0; to < 10; to++) {
    if (game.canMove(colIdx, cardIdx, to)) {
      const result = game.moveCards(colIdx, cardIdx, to);
      if (result && result.moved) {
        render();
        checkAfterMove(result);
        return;
      }
    }
  }
}

function checkAfterMove(result) {
  if (result.completedSequence) {
    showToast('Sequência completa! +100 pontos');
    if (game.checkWin()) {
      handleWin();
    }
  }
}

// === Distribuir Cartas do Estoque ===
function dealCards() {
  if (autoSolveActive || autoSolvePending) return;
  const result = game.dealFromStock();
  if (!result.dealt) {
    showToast('Não há mais cartas no estoque');
    return;
  }

  render();

  // Animar cartas distribuídas
  for (let i = 0; i < 10; i++) {
    const col = game.tableau[i];
    const lastCardIdx = col.length - 1;
    const cardEl = document.querySelector(`.card[data-col="${i}"][data-card-idx="${lastCardIdx}"]`);
    if (cardEl) {
      cardEl.classList.add('card-dealing');
      cardEl.style.animationDelay = (i * 50) + 'ms';
    }
  }

  if (result.completions && result.completions.length > 0) {
    showToast('Sequência completa! +100 pontos');
    if (game.checkWin()) {
      handleWin();
    }
  }
}

// === Desfazer ===
function undoMove() {
  if (autoSolveActive || autoSolvePending) return;
  if (game.undo()) {
    render();
  } else {
    showToast('Nada para desfazer');
  }
}

// === Dica ===
function showHint() {
  // Limpar hint anterior
  clearHint();

  const hints = game.getHints();
  if (hints.length === 0) {
    if (game.stock.length > 0) {
      showToast('Nenhum movimento encontrado. Tente distribuir do estoque.');
    } else {
      showToast('Nenhum movimento disponível');
    }
    return;
  }

  // Destacar apenas as colunas de origem de todas as opções encontradas
  const sourceCols = [...new Set(hints.map(h => h.fromCol))];
  for (const fromCol of sourceCols) {
    const colEl = document.querySelector(`.column[data-col="${fromCol}"]`);
    if (colEl) colEl.classList.add('hint-source');
  }

  // Remover destaque após 2 segundos
  hintTimeout = setTimeout(clearHint, 2000);
}

function clearHint() {
  if (hintTimeout) {
    clearTimeout(hintTimeout);
    hintTimeout = null;
  }
  document.querySelectorAll('.hint-source').forEach(el => el.classList.remove('hint-source'));
}

// === Vitória ===
function handleWin() {
  game.stopTimer();
  stopTimerUpdate();
  game.gameOver = true;

  if (!game.solverUsed) {
    stats.recordWin(game.numSuits, game.elapsed, game.score, game.moves);
  }

  const winStats = document.getElementById('win-stats');
  winStats.innerHTML = `
    <div class="win-stat">
      <span class="win-stat-value">${game.score}</span>
      <span class="win-stat-label">Pontos</span>
    </div>
    <div class="win-stat">
      <span class="win-stat-value">${game.moves}</span>
      <span class="win-stat-label">Movimentos</span>
    </div>
    <div class="win-stat">
      <span class="win-stat-value">${game.getElapsedFormatted()}</span>
      <span class="win-stat-label">Tempo</span>
    </div>
  `;

  document.getElementById('win-modal').classList.remove('hidden');
}

// === Estatísticas ===
function showStats() {
  game.pauseTimer();
  stopTimerUpdate();
  renderStatsContent(currentStatsTab);
  document.getElementById('stats-modal').classList.remove('hidden');
}

function closeStats() {
  document.getElementById('stats-modal').classList.add('hidden');
  if (gameActive) {
    game.resumeTimer();
    startTimerUpdate();
  }
}

function switchStatsTab(numSuits) {
  currentStatsTab = numSuits;
  document.querySelectorAll('.stats-tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
  renderStatsContent(numSuits);
}

function renderStatsContent(numSuits) {
  const s = stats.getStats(numSuits);
  const overall = stats.getOverallStats();
  const content = document.getElementById('stats-content');
  content.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${s.gamesPlayed}</div>
      <div class="stat-label">Jogos Iniciados</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.gamesWon} (${stats.getWinRate(numSuits)})</div>
      <div class="stat-label">Jogos Vencidos</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${overall.gamesWon} (${overall.winRate})</div>
      <div class="stat-label">Vitórias Gerais</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${overall.gamesPlayed}</div>
      <div class="stat-label">Jogos Iniciados (Geral)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.formatTime(s.bestTime)}</div>
      <div class="stat-label">Melhor Tempo</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.bestScore ?? '--'}</div>
      <div class="stat-label">Melhor Pontuação</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.fewestMoves ?? '--'}</div>
      <div class="stat-label">Menos Movimentos</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.formatTime(overall.bestTime)}</div>
      <div class="stat-label">Melhor Tempo (Geral)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${overall.bestScore ?? '--'}</div>
      <div class="stat-label">Maior Pontuação (Geral)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${overall.fewestMoves ?? '--'}</div>
      <div class="stat-label">Menos Movimentos (Geral)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.currentStreak}</div>
      <div class="stat-label">Sequência Atual</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.bestStreak}</div>
      <div class="stat-label">Melhor Sequência</div>
    </div>
    ${[1, 2, 4].map(ns => {
      let size = 0;
      try { size = JSON.parse(localStorage.getItem(`spider_pool_${ns}`) || '[]').length; } catch {}
      const label = ns === 1 ? '1 Naipe' : ns === 2 ? '2 Naipes' : '4 Naipes';
      return `<div class="stat-card">
      <div class="stat-value">${size} / ${_POOL_MAX}</div>
      <div class="stat-label">Pool ${label}</div>
    </div>`;
    }).join('')}
  `;
}

function confirmResetStats() {
  if (confirm('Tem certeza que deseja resetar todas as estatísticas?')) {
    stats.reset();
    renderStatsContent(currentStatsTab);
    showToast('Estatísticas resetadas');
  }
}

// === Utilitários ===
function closeAllModals() {
  document.getElementById('stats-modal').classList.add('hidden');
  document.getElementById('win-modal').classList.add('hidden');
  document.getElementById('solver-modal').classList.add('hidden');
  document.getElementById('pool-modal').classList.add('hidden');
}

function showToast(message) {
  // Remover toast existente
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 2500);
}

// === Auto-Solve ===
function autoSolve() {
  if (autoSolveActive) {
    stopAutoSolve();
    showToast('Resolução automática cancelada');
    return;
  }

  if (autoSolvePending) {
    cancelSolverSearch();
    return;
  }

  if (game.gameOver || autoSolvePending) return;

  autoSolvePending = true;
  updateAutoSolveButton('searching');
  showSolverModal();

  // Pequeno delay para a UI atualizar antes do solver rodar
  setTimeout(() => {
    const state = game._copyCurrentState();
    if (!ensureSolverWorker()) return;
    currentSolveRequestId = ++solverRequestId;
    solverWorker.postMessage({
      cmd: 'solve',
      requestId: currentSolveRequestId,
      state,
      greedyTrials: 300,
      greedyMaxMoves: 2000,
      backtrackTimeLimitMs: 30000
    });
  }, 60);
}

function executeSolutionStep(solution, index) {
  if (!autoSolveActive || index >= solution.length) {
    stopAutoSolve();
    return;
  }

  game.solverUsed = true;

  const move = solution[index];

  if (move.type === 'deal') {
    const result = game.dealFromStock();
    if (!result.dealt) {
      stopAutoSolve();
      return;
    }
    render();
    if (result.completions && result.completions.length > 0) {
      showToast('Sequência completa! +100 pontos');
      if (game.checkWin()) {
        stopAutoSolve();
        handleWin();
        return;
      }
    }
  } else {
    const result = game.moveCards(move.fromCol, move.cardIndex, move.toCol);
    if (!result || !result.moved) {
      stopAutoSolve();
      showToast('Erro na resolução automática');
      return;
    }
    render();
    if (result.completedSequence) {
      showToast('Sequência completa! +100 pontos');
      if (game.checkWin()) {
        stopAutoSolve();
        handleWin();
        return;
      }
    }
  }

  const delay = move.type === 'deal' ? 500 : 180;
  autoSolveTimeout = setTimeout(() => executeSolutionStep(solution, index + 1), delay);
}

function stopAutoSolve() {
  autoSolveActive = false;
  autoSolvePending = false;
  if (autoSolveTimeout) {
    clearTimeout(autoSolveTimeout);
    autoSolveTimeout = null;
  }
  updateAutoSolveButton('idle');
}

function showSolverModal() {
  const modal = document.getElementById('solver-modal');
  if (modal) modal.classList.remove('hidden');
}

function hideSolverModal() {
  const modal = document.getElementById('solver-modal');
  if (modal) modal.classList.add('hidden');
}

function ensureSolverWorker() {
  if (typeof Worker === 'undefined') {
    autoSolvePending = false;
    updateAutoSolveButton('idle');
    hideSolverModal();
    showToast('Seu navegador não suporta busca assíncrona');
    return false;
  }
  if (solverWorker) return true;
  try {
    solverWorker = new Worker('js/solver-worker.js');
  } catch (err) {
    try {
      const blob = new Blob([SOLVER_WORKER_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      solverWorker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);
    } catch {
      autoSolvePending = false;
      updateAutoSolveButton('idle');
      hideSolverModal();
      showToast('Não foi possível iniciar o solver');
      return false;
    }
  }
  solverWorker.onmessage = (e) => {
    const msg = e.data || {};
    if (!msg.requestId || msg.requestId !== currentSolveRequestId) return;

    autoSolvePending = false;
    hideSolverModal();

    if (msg.type === 'solution') {
      const solution = Array.isArray(msg.solution) ? msg.solution : [];
      autoSolveActive = true;
      updateAutoSolveButton('solving');
      executeSolutionStep(solution, 0);
      return;
    }

    updateAutoSolveButton('idle');
    if (msg.type === 'nosolution') {
      showToast('Solver não encontrou caminho vencedor para este estado');
    } else if (msg.type === 'cancelled') {
      showToast('Busca cancelada');
    } else if (msg.type === 'error') {
      showToast(msg.message || 'Erro na resolução automática');
    }
  };
  return true;
}

function cancelSolverSearch(silent = false) {
  if (!autoSolvePending) return;
  autoSolvePending = false;
  updateAutoSolveButton('idle');
  hideSolverModal();
  if (solverWorker && currentSolveRequestId) {
    solverWorker.postMessage({ cmd: 'cancel', requestId: currentSolveRequestId });
  }
  currentSolveRequestId = 0;
  if (!silent) showToast('Busca cancelada');
}

function updateAutoSolveButton(state) {
  const btn = document.getElementById('auto-solve-btn');
  if (!btn) return;
  const icon = btn.querySelector('.tb-icon');
  const label = btn.querySelector('.tb-label');
  btn.classList.remove('solving', 'searching');

  if (state === 'searching') {
    icon.textContent = '⏳';
    label.textContent = 'Buscando';
    btn.classList.add('searching');
  } else if (state === 'solving') {
    icon.textContent = '⏹';
    label.textContent = 'Parar';
    btn.classList.add('solving');
  } else {
    icon.textContent = '▶';
    label.textContent = 'Resolver';
  }
}

// === Pool Warmup ===
function getPoolSize(numSuits) {
  try {
    return JSON.parse(localStorage.getItem(`spider_pool_${numSuits}`) || '[]').length;
  } catch {
    return 0;
  }
}

function prewarmPools() {
  seedPoolsFromFiles();
  if (typeof _startSpiderPoolWorkers === 'function') _startSpiderPoolWorkers();
  [1, 2, 4].forEach(ns => {
    if (getPoolSize(ns) < POOL_MIN_START) {
      if (typeof game.generatePoolAsync === 'function') game.generatePoolAsync(ns);
    }
  });
}

function seedPoolsFromFiles() {
  const sources = [
    { ns: 1, list: window.SPIDER_POOL_1 },
    { ns: 2, list: window.SPIDER_POOL_2 },
    { ns: 4, list: window.SPIDER_POOL_4 }
  ];

  for (const src of sources) {
    if (!Array.isArray(src.list) || src.list.length < POOL_FILE_MIN) continue;
    game.seedPoolFromList(src.ns, src.list, { min: POOL_FILE_MIN, max: POOL_FILE_MAX });
  }
}

function showPoolModal(numSuits, size) {
  const modal = document.getElementById('pool-modal');
  if (!modal) return;
  const label = modal.querySelector('[data-pool-label]');
  const count = modal.querySelector('[data-pool-count]');
  if (label) label.textContent = numSuits === 1 ? '1 Naipe' : numSuits === 2 ? '2 Naipes' : '4 Naipes';
  if (count) count.textContent = `${size} / ${POOL_MIN_START}`;
  modal.classList.remove('hidden');
}

function hidePoolModal() {
  const modal = document.getElementById('pool-modal');
  if (modal) modal.classList.add('hidden');
}

function cancelPoolWait(silent = false) {
  if (poolWaitInterval) {
    clearInterval(poolWaitInterval);
    poolWaitInterval = null;
  }
  pendingStart = null;
  hidePoolModal();
  if (!silent) showToast('Preparação cancelada');
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
}

function ensurePoolMinAndStart(numSuits) {
  const size = getPoolSize(numSuits);
  if (size >= POOL_MIN_START) {
    startGameFromPool(numSuits);
    return;
  }

  pendingStart = { numSuits };
  showPoolModal(numSuits, size);

  if (poolWaitInterval) clearInterval(poolWaitInterval);
  poolWaitInterval = setInterval(() => {
    const current = getPoolSize(numSuits);
    showPoolModal(numSuits, current);
    if (current >= POOL_MIN_START) {
      clearInterval(poolWaitInterval);
      poolWaitInterval = null;
      hidePoolModal();
      startGameFromPool(numSuits);
    }
  }, 300);
}

function startGameFromPool(numSuits) {
  try {
    game.newGame(numSuits, { forcePool: true });
    stats.recordGameStart(numSuits);
    render();
    startTimerUpdate();
    pendingStart = null;
    gameActive = true;
    updateResumeButton();
  } catch (err) {
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    showToast(err && err.message ? err.message : 'Falha ao iniciar jogo');
  }
}

function updateResumeButton() {
  const btn = document.getElementById('resume-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !gameActive);
}

window.addEventListener('spiderPoolUpdate', (e) => {
  if (!pendingStart || !e || !e.detail) return;
  const { numSuits, size } = e.detail;
  if (pendingStart.numSuits !== numSuits) return;
  showPoolModal(numSuits, size);
});

// === Responsividade ===
window.addEventListener('resize', () => {
  if (!document.getElementById('game-screen').classList.contains('hidden')) {
    render();
  }
});

const dealIdInput = document.getElementById('deal-id-input');
if (dealIdInput) {
  dealIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      startGameFromId();
    }
  });
}
