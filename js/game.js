class SpiderGame {
  constructor() {
    this.tableau = [];       // 10 colunas
    this.stock = [];         // cartas restantes
    this.completed = [];     // sequências completas removidas
    this.history = [];       // histórico para undo
    this.moves = 0;
    this.score = 500;
    this.numSuits = 1;
    this.startTime = null;
    this.elapsed = 0;
    this.gameOver = false;
    this.timerInterval = null;
    this.savedDealOrder = null; // para reiniciar mesmo jogo
    this.gameId = null;
  }

  newGame(numSuits) {
    this.numSuits = numSuits;

    const MAX_DEALS = 50;
    let deck;
    for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
      deck = new Deck(numSuits);
      deck.shuffle();
      if (this._checkWinnable(deck.cards)) break;
    }

    // Salvar a ordem das cartas para poder reiniciar e compartilhar via ID
    this._setDealOrderAndId(deck.cards);

    this._setupGame(deck.cards);
  }

  restartGame() {
    if (!this.savedDealOrder) return;

    // Recriar cartas na mesma ordem
    const cards = this.savedDealOrder.map(c => new Card(c.suit, c.value));
    this._setupGame(cards);
  }

  newGameFromId(gameId) {
    try {
      const decoded = this._decodeGameId(gameId);
      this.numSuits = decoded.numSuits;
      this.savedDealOrder = decoded.savedDealOrder;
      this.gameId = decoded.gameId;

      const cards = this.savedDealOrder.map(c => new Card(c.suit, c.value));
      this._setupGame(cards);

      return { ok: true, numSuits: this.numSuits, gameId: this.gameId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _setDealOrderAndId(cards) {
    this.savedDealOrder = cards.map(c => ({ suit: c.suit, value: c.value }));
    this.gameId = this._encodeGameId(this.numSuits, this.savedDealOrder);
  }

  _encodeGameId(numSuits, savedDealOrder) {
    const bytes = savedDealOrder.map(card => {
      const suitIdx = SUIT_KEYS.indexOf(card.suit);
      if (suitIdx < 0) throw new Error('Naipe inválido na serialização');
      if (card.value < 1 || card.value > 13) throw new Error('Valor inválido na serialização');
      return suitIdx * 13 + (card.value - 1);
    });

    const payload = this._bytesToBase64Url(bytes);
    const checksum = this._computeGameChecksum(numSuits, bytes).toString(16).padStart(4, '0');
    return `SP1-${numSuits}-${payload}-${checksum}`;
  }

  _decodeGameId(gameId) {
    if (typeof gameId !== 'string' || gameId.trim() === '') {
      throw new Error('ID do jogo vazio');
    }

    const trimmed = gameId.trim();
    const parts = trimmed.split('-');
    if (parts.length !== 4 || parts[0] !== 'SP1') {
      throw new Error('Formato de ID inválido');
    }

    const numSuits = Number(parts[1]);
    if (![1, 2, 4].includes(numSuits)) {
      throw new Error('Quantidade de naipes inválida no ID');
    }

    if (!/^[0-9a-fA-F]{4}$/.test(parts[3])) {
      throw new Error('Checksum inválido no ID');
    }

    const bytes = this._base64UrlToBytes(parts[2]);
    if (bytes.length !== 104) {
      throw new Error('ID com quantidade de cartas inválida');
    }

    for (const b of bytes) {
      if (b < 0 || b > 51) {
        throw new Error('ID contém carta inválida');
      }
    }

    const expectedChecksum = this._computeGameChecksum(numSuits, bytes);
    const receivedChecksum = parseInt(parts[3], 16);
    if (expectedChecksum !== receivedChecksum) {
      throw new Error('Checksum não confere');
    }

    const allowedSuits = new Set(SUIT_KEYS.slice(0, numSuits));
    const repeats = 104 / (13 * numSuits);
    const counters = {};
    for (const suit of allowedSuits) {
      counters[suit] = Array(14).fill(0);
    }

    const savedDealOrder = bytes.map(code => {
      const suitIdx = Math.floor(code / 13);
      const value = (code % 13) + 1;
      const suit = SUIT_KEYS[suitIdx];

      if (!allowedSuits.has(suit)) {
        throw new Error('ID contém naipes incompatíveis com a dificuldade');
      }

      counters[suit][value]++;
      return { suit, value };
    });

    for (const suit of allowedSuits) {
      for (let value = 1; value <= 13; value++) {
        if (counters[suit][value] !== repeats) {
          throw new Error('Distribuição de cartas inválida no ID');
        }
      }
    }

    return {
      numSuits,
      savedDealOrder,
      gameId: this._encodeGameId(numSuits, savedDealOrder)
    };
  }

  _bytesToBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  _base64UrlToBytes(payload) {
    if (!/^[A-Za-z0-9\-_]+$/.test(payload)) {
      throw new Error('Payload inválido no ID');
    }

    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    let binary = '';
    try {
      binary = atob(base64);
    } catch {
      throw new Error('Payload inválido no ID');
    }

    const bytes = [];
    for (let i = 0; i < binary.length; i++) {
      bytes.push(binary.charCodeAt(i));
    }
    return bytes;
  }

  _computeGameChecksum(numSuits, bytes) {
    let checksum = (numSuits * 131) & 0xffff;
    for (const b of bytes) {
      checksum = ((checksum * 31) + b + 7) & 0xffff;
    }
    return checksum;
  }

  _setupGame(cards) {
    this.tableau = Array.from({ length: 10 }, () => []);
    this.stock = [];
    this.completed = [];
    this.history = [];
    this.moves = 0;
    this.score = 500;
    this.gameOver = false;
    this.elapsed = 0;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    let cardIndex = 0;

    // Distribuir: 4 colunas com 6 cartas, 6 colunas com 5 cartas = 54 cartas
    for (let col = 0; col < 10; col++) {
      const numCards = col < 4 ? 6 : 5;
      for (let i = 0; i < numCards; i++) {
        this.tableau[col].push(cards[cardIndex++]);
      }
      // Virar a última carta de cada coluna
      this.tableau[col][this.tableau[col].length - 1].faceUp = true;
    }

    // Restante vai para o estoque (50 cartas = 5 grupos de 10)
    this.stock = cards.slice(cardIndex);

    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      this.elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    }, 1000);
  }

  getElapsedFormatted() {
    const mins = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const secs = (this.elapsed % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  // Verifica se uma sequência de cartas a partir de cardIndex pode ser movida
  canPickUp(colIndex, cardIndex) {
    const col = this.tableau[colIndex];
    if (cardIndex < 0 || cardIndex >= col.length) return false;
    if (!col[cardIndex].faceUp) return false;

    // Todas as cartas do cardIndex até o final devem ser sequência descendente do mesmo naipe
    for (let i = cardIndex; i < col.length - 1; i++) {
      if (col[i].suit !== col[i + 1].suit) return false;
      if (col[i].value !== col[i + 1].value + 1) return false;
    }
    return true;
  }

  // Verifica se pode mover cartas para a coluna alvo
  canMove(fromCol, cardIndex, toCol) {
    if (fromCol === toCol) return false;
    if (!this.canPickUp(fromCol, cardIndex)) return false;

    const targetColumn = this.tableau[toCol];
    const movingCard = this.tableau[fromCol][cardIndex];

    // Coluna vazia aceita qualquer carta
    if (targetColumn.length === 0) return true;

    const topCard = targetColumn[targetColumn.length - 1];
    // A carta do topo deve ter valor imediatamente superior
    return topCard.value === movingCard.value + 1;
  }

  // Executa o movimento
  moveCards(fromCol, cardIndex, toCol) {
    if (!this.canMove(fromCol, cardIndex, toCol)) return false;

    const cardsToMove = this.tableau[fromCol].splice(cardIndex);
    const flippedCard = this._flipTopCard(fromCol);

    // Salvar no histórico para undo
    this.history.push({
      type: 'move',
      fromCol,
      toCol,
      cardIndex,
      numCards: cardsToMove.length,
      flippedCard: flippedCard
    });

    this.tableau[toCol].push(...cardsToMove);
    this.moves++;
    this.score = Math.max(0, this.score - 1);

    // Verificar sequência completa na coluna alvo
    const removed = this.checkCompleteSequence(toCol);

    return { moved: true, completedSequence: removed };
  }

  // Vira a carta do topo da coluna se estiver virada para baixo
  _flipTopCard(colIndex) {
    const col = this.tableau[colIndex];
    if (col.length > 0 && !col[col.length - 1].faceUp) {
      col[col.length - 1].faceUp = true;
      this.score += 5;
      return true;
    }
    return false;
  }

  // Verifica e remove sequência completa K→A do mesmo naipe
  checkCompleteSequence(colIndex) {
    const col = this.tableau[colIndex];
    if (col.length < 13) return false;

    // Verificar se as últimas 13 cartas formam K→A do mesmo naipe
    const startIdx = col.length - 13;

    // A primeira carta da sequência deve ser K (13)
    if (col[startIdx].value !== 13) return false;

    const suit = col[startIdx].suit;
    for (let i = 0; i < 13; i++) {
      const card = col[startIdx + i];
      if (!card.faceUp) return false;
      if (card.suit !== suit) return false;
      if (card.value !== 13 - i) return false;
    }

    // Remover sequência completa
    const removedCards = col.splice(startIdx, 13);
    this.completed.push(removedCards);
    this.score += 100;

    // Virar carta do topo se necessário
    this._flipTopCard(colIndex);

    // Atualizar histórico
    if (this.history.length > 0) {
      this.history[this.history.length - 1].completedSequence = {
        colIndex,
        cards: removedCards
      };
    }

    return true;
  }

  // Distribui cartas do estoque (uma por coluna, inclusive vazias)
  dealFromStock() {
    if (this.stock.length === 0) return { dealt: false, reason: 'empty' };

    const dealtCards = [];
    for (let i = 0; i < 10; i++) {
      if (this.stock.length === 0) break;
      const card = this.stock.pop();
      card.faceUp = true;
      this.tableau[i].push(card);
      dealtCards.push({ col: i, card });
    }

    this.history.push({
      type: 'deal',
      dealtCards
    });

    this.moves++;

    // Verificar sequências completas em todas as colunas
    const completions = [];
    for (let i = 0; i < 10; i++) {
      if (this.checkCompleteSequence(i)) {
        completions.push(i);
      }
    }

    return { dealt: true, completions };
  }

  // Desfazer última ação
  undo() {
    if (this.history.length === 0) return false;

    const action = this.history.pop();

    if (action.type === 'move') {
      // Restaurar sequência completa se houve
      if (action.completedSequence) {
        const seq = action.completedSequence;
        this.tableau[seq.colIndex].push(...seq.cards);
        this.completed.pop();
        this.score -= 100;
      }

      // Desvirar carta se foi virada
      if (action.flippedCard) {
        const fromCol = this.tableau[action.fromCol];
        if (fromCol.length > 0) {
          fromCol[fromCol.length - 1].faceUp = false;
          this.score -= 5;
        }
      }

      // Mover cartas de volta
      const cards = this.tableau[action.toCol].splice(-action.numCards);
      this.tableau[action.fromCol].push(...cards);

      this.moves--;
      this.score = Math.min(500, this.score + 1);
    } else if (action.type === 'deal') {
      // Devolver cartas distribuídas ao estoque (ordem reversa)
      for (let i = action.dealtCards.length - 1; i >= 0; i--) {
        const card = this.tableau[action.dealtCards[i].col].pop();
        card.faceUp = false;
        this.stock.push(card);
      }

      this.moves--;
    }

    return true;
  }

  _getTopSameSuitRunLength(colIndex) {
    const col = this.tableau[colIndex];
    if (col.length === 0) return 0;

    let runLength = 1;
    for (let i = col.length - 1; i > 0; i--) {
      const top = col[i];
      const below = col[i - 1];
      if (!below.faceUp) break;
      if (below.suit !== top.suit) break;
      if (below.value !== top.value + 1) break;
      runLength++;
    }
    return runLength;
  }

  _wouldBreakSourceRun(fromCol, cardIndex) {
    if (cardIndex === 0) return false;

    const col = this.tableau[fromCol];
    const movingCard = col[cardIndex];
    const below = col[cardIndex - 1];

    if (!below.faceUp) return false;
    return below.suit === movingCard.suit && below.value === movingCard.value + 1;
  }

  // Retorna todas as opções de dica válidas:
  // - carta de destino deve ser imediatamente maior (regra do jogo)
  // - mesmo naipe é preferência (não obrigação)
  // - não quebrar sequência do mesmo naipe na origem
  getHints() {
    const hints = [];
    const emptyHints = [];

    for (let from = 0; from < 10; from++) {
      const col = this.tableau[from];
      for (let ci = col.length - 1; ci >= 0; ci--) {
        if (!this.canPickUp(from, ci)) break;
        if (this._wouldBreakSourceRun(from, ci)) continue;

        const movingCard = col[ci];
        const movingRunLength = col.length - ci;

        for (let to = 0; to < 10; to++) {
          if (!this.canMove(from, ci, to)) continue;

          const targetCol = this.tableau[to];
          const targetRunLength = targetCol.length > 0 ? this._getTopSameSuitRunLength(to) : 0;
          const sameSuit = targetCol.length > 0 && targetCol[targetCol.length - 1].suit === movingCard.suit;

          // Evita sugerir enfraquecer pilhas boas: mover sequência longa para naipe diferente.
          if (!sameSuit && movingRunLength > 1) continue;

          const hint = {
            fromCol: from,
            cardIndex: ci,
            toCol: to,
            sameSuit,
            movingRunLength,
            targetRunLength,
            combinedRunLength: movingRunLength + targetRunLength
          };

          if (targetCol.length === 0) {
            emptyHints.push(hint);
          } else {
            hints.push(hint);
          }
        }
      }
    }

    hints.sort((a, b) =>
      Number(b.sameSuit) - Number(a.sameSuit) ||
      b.combinedRunLength - a.combinedRunLength ||
      a.fromCol - b.fromCol ||
      a.cardIndex - b.cardIndex ||
      a.toCol - b.toCol
    );

    // Só sugere vazias se não houver movimento útil para colunas com cartas.
    if (hints.length > 0) return hints;

    emptyHints.sort((a, b) =>
      Number(b.sameSuit) - Number(a.sameSuit) ||
      b.movingRunLength - a.movingRunLength ||
      a.fromCol - b.fromCol ||
      a.cardIndex - b.cardIndex ||
      a.toCol - b.toCol
    );

    return emptyHints;
  }

  // Compatibilidade com chamadas legadas
  getHint() {
    const hints = this.getHints();
    return hints.length > 0 ? hints[0] : null;
  }

  // Verifica vitória
  checkWin() {
    return this.completed.length === 8;
  }

  // === Verificação de vencibilidade ===

  _checkWinnable(cards) {
    const TRIALS = 25;
    const MAX_MOVES = 500;
    for (let t = 0; t < TRIALS; t++) {
      if (this._trySolve(cards, t, MAX_MOVES)) return true;
    }
    return false;
  }

  _createSolverState(cards) {
    const tableau = Array.from({ length: 10 }, () => []);
    let idx = 0;
    for (let col = 0; col < 10; col++) {
      const num = col < 4 ? 6 : 5;
      for (let i = 0; i < num; i++) {
        tableau[col].push({
          suit: cards[idx].suit,
          value: cards[idx].value,
          faceUp: i === num - 1
        });
        idx++;
      }
    }
    const stock = [];
    for (let i = idx; i < cards.length; i++) {
      stock.push({ suit: cards[i].suit, value: cards[i].value, faceUp: false });
    }
    return { tableau, stock, completed: 0 };
  }

  _solverFlipTop(col) {
    if (col.length > 0 && !col[col.length - 1].faceUp) {
      col[col.length - 1].faceUp = true;
    }
  }

  _solverRemoveSequences(state) {
    let found = true;
    while (found) {
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
          this._solverFlipTop(col);
          found = true;
          break;
        }
      }
    }
  }

  _solverGetMoves(state) {
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
            if (ci === 0) continue; // mover coluna inteira para vazia não ajuda
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

  _solverDeal(state) {
    for (let i = 0; i < 10 && state.stock.length > 0; i++) {
      const card = state.stock.pop();
      card.faceUp = true;
      state.tableau[i].push(card);
    }
  }

  _trySolve(cards, trial, maxMoves) {
    const state = this._createSolverState(cards);
    let seed = trial * 997 + 13;
    let moveCount = 0;
    let noProgressCount = 0;

    while (moveCount < maxMoves && state.completed < 8) {
      this._solverRemoveSequences(state);
      if (state.completed >= 8) return true;

      const moves = this._solverGetMoves(state);

      if (moves.length === 0) {
        if (state.stock.length > 0) {
          this._solverDeal(state);
          moveCount++;
          noProgressCount = 0;
          continue;
        }
        break;
      }

      // Escolher movimento com variação controlada por trial
      let pickIdx = 0;
      if (moves.length > 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const r = (seed >>> 0) / 0x80000000;
        if (r < 0.6) pickIdx = 0;
        else if (r < 0.85) pickIdx = Math.min(1, moves.length - 1);
        else pickIdx = Math.min(2, moves.length - 1);
      }

      const move = moves[pickIdx];
      const movedCards = state.tableau[move.from].splice(move.ci);
      state.tableau[move.to].push(...movedCards);
      this._solverFlipTop(state.tableau[move.from]);

      moveCount++;
      noProgressCount++;

      // Se sem progresso por muito tempo, tentar distribuir do estoque
      if (noProgressCount > 40 && state.stock.length > 0) {
        this._solverDeal(state);
        moveCount++;
        noProgressCount = 0;
      }
    }

    return state.completed >= 8;
  }

  // Para o timer
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
