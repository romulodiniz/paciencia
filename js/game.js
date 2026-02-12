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

    // Salvar a ordem das cartas para poder reiniciar
    this.savedDealOrder = deck.cards.map(c => ({ suit: c.suit, value: c.value }));

    this._setupGame(deck.cards);
  }

  restartGame() {
    if (!this.savedDealOrder) return;

    // Recriar cartas na mesma ordem
    const cards = this.savedDealOrder.map(c => new Card(c.suit, c.value));
    this._setupGame(cards);
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

  // Distribui cartas do estoque (pula colunas vazias)
  dealFromStock() {
    if (this.stock.length === 0) return { dealt: false, reason: 'empty' };

    // Retirar até 10 cartas do estoque (uma por coluna)
    const numToPop = Math.min(10, this.stock.length);
    const poppedCards = [];
    for (let i = 0; i < numToPop; i++) {
      poppedCards.push(this.stock.pop());
    }

    const dealtCards = [];    // cartas colocadas nas colunas
    const returnedCards = []; // cartas para colunas vazias, devolvidas ao estoque

    for (let i = 0; i < poppedCards.length; i++) {
      const card = poppedCards[i];
      if (this.tableau[i].length > 0) {
        card.faceUp = true;
        this.tableau[i].push(card);
        dealtCards.push({ col: i, card });
      } else {
        // Coluna vazia: carta volta para o topo do estoque
        returnedCards.push({ col: i, card });
      }
    }

    // Devolver cartas de colunas vazias ao topo do estoque
    // (primeira devolvida fica no topo para ser distribuída primeiro na próxima vez)
    for (let i = returnedCards.length - 1; i >= 0; i--) {
      this.stock.push(returnedCards[i].card);
    }

    if (dealtCards.length === 0) {
      return { dealt: false, reason: 'empty' };
    }

    this.history.push({
      type: 'deal',
      dealtCards,
      returnedCards
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
      // Remover cartas devolvidas do topo do estoque
      const returnedCards = action.returnedCards || [];
      for (let i = 0; i < returnedCards.length; i++) {
        this.stock.pop();
      }

      // Remover cartas distribuídas das colunas (ordem reversa)
      for (let i = action.dealtCards.length - 1; i >= 0; i--) {
        this.tableau[action.dealtCards[i].col].pop();
      }

      // Reconstruir a ordem original e devolver ao estoque
      const allEntries = [...action.dealtCards, ...returnedCards].sort((a, b) => a.col - b.col);
      for (let i = allEntries.length - 1; i >= 0; i--) {
        allEntries[i].card.faceUp = false;
        this.stock.push(allEntries[i].card);
      }

      this.moves--;
    }

    return true;
  }

  // Sugere um movimento válido
  getHint() {
    // Prioridade 1: Movimentos que formam sequências do mesmo naipe
    for (let from = 0; from < 10; from++) {
      const col = this.tableau[from];
      for (let ci = col.length - 1; ci >= 0; ci--) {
        if (!this.canPickUp(from, ci)) break;
        for (let to = 0; to < 10; to++) {
          if (this.canMove(from, ci, to)) {
            const targetCol = this.tableau[to];
            if (targetCol.length > 0) {
              const topCard = targetCol[targetCol.length - 1];
              const movingCard = col[ci];
              // Preferir mover para mesma cor/naipe
              if (topCard.suit === movingCard.suit) {
                return { fromCol: from, cardIndex: ci, toCol: to, priority: 'same_suit' };
              }
            }
          }
        }
      }
    }

    // Prioridade 2: Qualquer movimento válido (exceto para colunas vazias sem necessidade)
    for (let from = 0; from < 10; from++) {
      const col = this.tableau[from];
      for (let ci = col.length - 1; ci >= 0; ci--) {
        if (!this.canPickUp(from, ci)) break;
        for (let to = 0; to < 10; to++) {
          if (this.canMove(from, ci, to) && this.tableau[to].length > 0) {
            return { fromCol: from, cardIndex: ci, toCol: to, priority: 'any' };
          }
        }
      }
    }

    // Prioridade 3: Mover para coluna vazia
    for (let from = 0; from < 10; from++) {
      const col = this.tableau[from];
      for (let ci = col.length - 1; ci >= 0; ci--) {
        if (!this.canPickUp(from, ci)) break;
        for (let to = 0; to < 10; to++) {
          if (this.canMove(from, ci, to)) {
            return { fromCol: from, cardIndex: ci, toCol: to, priority: 'empty' };
          }
        }
      }
    }

    return null;
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
    const numToPop = Math.min(10, state.stock.length);
    const popped = [];
    for (let i = 0; i < numToPop; i++) {
      popped.push(state.stock.pop());
    }
    const returned = [];
    for (let i = 0; i < popped.length; i++) {
      if (state.tableau[i].length > 0) {
        popped[i].faceUp = true;
        state.tableau[i].push(popped[i]);
      } else {
        returned.push(popped[i]);
      }
    }
    for (let i = returned.length - 1; i >= 0; i--) {
      state.stock.push(returned[i]);
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
