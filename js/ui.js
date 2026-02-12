// === Estado Global ===
const game = new SpiderGame();
const stats = new Stats();
let currentStatsTab = 1;
let timerUpdateInterval = null;
let hintTimeout = null;

// === Drag & Drop State ===
let dragState = null; // { fromCol, cardIndex, cards, ghost, offsetX, offsetY }
let justDragged = false;

// === Inicialização ===
function startGame(numSuits) {
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');

  showToast('Gerando jogo vencível...');

  // Usar setTimeout para permitir que a UI atualize antes do solver rodar
  setTimeout(() => {
    game.newGame(numSuits);
    stats.recordGameStart(numSuits);
    render();
    startTimerUpdate();
  }, 50);
}

function showMenu() {
  game.stopTimer();
  stopTimerUpdate();
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  closeAllModals();
}

function confirmNewGame() {
  closeAllModals();
  startGame(game.numSuits);
}

function restartGame() {
  closeAllModals();
  game.restartGame();
  render();
  startTimerUpdate();
  showToast('Jogo reiniciado');
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
      colEl.style.minHeight = '160px';
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
  // Calcular baseado na largura real da coluna (aspect-ratio 5:7)
  const col = document.querySelector('.column');
  if (col) {
    const colWidth = col.offsetWidth;
    return Math.max(colWidth * 7 / 5, 140);
  }
  return window.innerWidth <= 500 ? 110 : (window.innerWidth <= 800 ? 140 : 170);
}

function calculateCardOffset(col, cardIdx) {
  const isSmall = window.innerWidth <= 500;
  let offset = 0;
  for (let i = 0; i < cardIdx; i++) {
    if (isSmall) {
      offset += col[i].faceUp ? 32 : 14;
    } else {
      offset += col[i].faceUp ? 48 : 20;
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
  // Ignorar click após drag
  if (justDragged) return;
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

  const hint = game.getHint();
  if (!hint) {
    if (game.stock.length > 0) {
      showToast('Nenhum movimento encontrado. Tente distribuir do estoque.');
    } else {
      showToast('Nenhum movimento disponível');
    }
    return;
  }

  // Destacar cartas da dica
  const col = game.tableau[hint.fromCol];
  for (let i = hint.cardIndex; i < col.length; i++) {
    const cardEl = document.querySelector(`.card[data-col="${hint.fromCol}"][data-card-idx="${i}"]`);
    if (cardEl) cardEl.classList.add('hint-card');
  }

  // Destacar coluna alvo
  const targetColEl = document.querySelector(`.column[data-col="${hint.toCol}"]`);
  if (targetColEl) targetColEl.classList.add('hint-target');

  // Remover destaque após 2 segundos
  hintTimeout = setTimeout(clearHint, 2000);
}

function clearHint() {
  if (hintTimeout) {
    clearTimeout(hintTimeout);
    hintTimeout = null;
  }
  document.querySelectorAll('.hint-card').forEach(el => el.classList.remove('hint-card'));
  document.querySelectorAll('.hint-target').forEach(el => el.classList.remove('hint-target'));
}

// === Vitória ===
function handleWin() {
  game.stopTimer();
  stopTimerUpdate();
  game.gameOver = true;

  stats.recordWin(game.numSuits, game.elapsed, game.score, game.moves);

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
  renderStatsContent(currentStatsTab);
  document.getElementById('stats-modal').classList.remove('hidden');
}

function closeStats() {
  document.getElementById('stats-modal').classList.add('hidden');
}

function switchStatsTab(numSuits) {
  currentStatsTab = numSuits;
  document.querySelectorAll('.stats-tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
  renderStatsContent(numSuits);
}

function renderStatsContent(numSuits) {
  const s = stats.getStats(numSuits);
  const content = document.getElementById('stats-content');
  content.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${s.gamesPlayed}</div>
      <div class="stat-label">Jogos Iniciados</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.gamesWon}</div>
      <div class="stat-label">Vitórias</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.getWinRate(numSuits)}</div>
      <div class="stat-label">Taxa de Vitória</div>
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
      <div class="stat-value">${s.currentStreak}</div>
      <div class="stat-label">Sequência Atual</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.bestStreak}</div>
      <div class="stat-label">Melhor Sequência</div>
    </div>
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

// === Responsividade ===
window.addEventListener('resize', () => {
  if (!document.getElementById('game-screen').classList.contains('hidden')) {
    render();
  }
});
