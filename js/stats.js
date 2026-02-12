class Stats {
  constructor() {
    this.STORAGE_KEY = 'spider-solitaire-stats';
    this.data = this._load();
  }

  _defaultData() {
    return {
      1: this._defaultSuitStats(),
      2: this._defaultSuitStats(),
      4: this._defaultSuitStats()
    };
  }

  _defaultSuitStats() {
    return {
      gamesPlayed: 0,
      gamesWon: 0,
      bestTime: null,
      bestScore: null,
      fewestMoves: null,
      currentStreak: 0,
      bestStreak: 0
    };
  }

  _load() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // ignore
    }
    return this._defaultData();
  }

  _save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      // ignore
    }
  }

  recordGameStart(numSuits) {
    this.data[numSuits].gamesPlayed++;
    this._save();
  }

  recordWin(numSuits, time, score, moves) {
    const stats = this.data[numSuits];
    stats.gamesWon++;
    stats.currentStreak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);

    if (stats.bestTime === null || time < stats.bestTime) {
      stats.bestTime = time;
    }
    if (stats.bestScore === null || score > stats.bestScore) {
      stats.bestScore = score;
    }
    if (stats.fewestMoves === null || moves < stats.fewestMoves) {
      stats.fewestMoves = moves;
    }

    this._save();
  }

  recordLoss(numSuits) {
    this.data[numSuits].currentStreak = 0;
    this._save();
  }

  getStats(numSuits) {
    return this.data[numSuits];
  }

  getAllStats() {
    return this.data;
  }

  formatTime(seconds) {
    if (seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  getWinRate(numSuits) {
    const stats = this.data[numSuits];
    if (stats.gamesPlayed === 0) return '0%';
    return Math.round((stats.gamesWon / stats.gamesPlayed) * 100) + '%';
  }

  reset() {
    this.data = this._defaultData();
    this._save();
  }
}
