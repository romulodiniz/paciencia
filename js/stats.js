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
    const defaultData = this._defaultData();
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return this._normalizeData(parsed, defaultData);
      }
    } catch (e) {
      // ignore
    }
    return defaultData;
  }

  _normalizeData(data, defaultData) {
    const normalized = {};
    for (const suits of [1, 2, 4]) {
      const source = data && data[suits] ? data[suits] : {};
      const fallback = defaultData[suits];
      normalized[suits] = {
        gamesPlayed: Number.isFinite(source.gamesPlayed) ? source.gamesPlayed : fallback.gamesPlayed,
        gamesWon: Number.isFinite(source.gamesWon) ? source.gamesWon : fallback.gamesWon,
        bestTime: Number.isFinite(source.bestTime) ? source.bestTime : fallback.bestTime,
        bestScore: Number.isFinite(source.bestScore) ? source.bestScore : fallback.bestScore,
        fewestMoves: Number.isFinite(source.fewestMoves) ? source.fewestMoves : fallback.fewestMoves,
        currentStreak: Number.isFinite(source.currentStreak) ? source.currentStreak : fallback.currentStreak,
        bestStreak: Number.isFinite(source.bestStreak) ? source.bestStreak : fallback.bestStreak
      };
    }
    return normalized;
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

  getOverallStats() {
    const all = [this.data[1], this.data[2], this.data[4]];
    const totalPlayed = all.reduce((acc, s) => acc + s.gamesPlayed, 0);
    const totalWon = all.reduce((acc, s) => acc + s.gamesWon, 0);

    let bestTime = null;
    let bestScore = null;
    let fewestMoves = null;

    for (const s of all) {
      if (s.bestTime !== null && (bestTime === null || s.bestTime < bestTime)) bestTime = s.bestTime;
      if (s.bestScore !== null && (bestScore === null || s.bestScore > bestScore)) bestScore = s.bestScore;
      if (s.fewestMoves !== null && (fewestMoves === null || s.fewestMoves < fewestMoves)) fewestMoves = s.fewestMoves;
    }

    const winRate = totalPlayed === 0 ? '0%' : Math.round((totalWon / totalPlayed) * 100) + '%';

    return {
      gamesPlayed: totalPlayed,
      gamesWon: totalWon,
      winRate,
      bestTime,
      bestScore,
      fewestMoves
    };
  }

  reset() {
    this.data = this._defaultData();
    this._save();
  }
}
