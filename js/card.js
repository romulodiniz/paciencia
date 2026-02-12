const SUITS = {
  spades: { symbol: '♠', color: 'black', name: 'Espadas' },
  hearts: { symbol: '♥', color: 'red', name: 'Copas' },
  diamonds: { symbol: '♦', color: 'red', name: 'Ouros' },
  clubs: { symbol: '♣', color: 'black', name: 'Paus' }
};

const SUIT_KEYS = ['spades', 'hearts', 'diamonds', 'clubs'];

const VALUE_NAMES = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K'
};

class Card {
  constructor(suit, value) {
    this.suit = suit;
    this.value = value;
    this.faceUp = false;
    this.id = `${suit}-${value}-${Math.random().toString(36).substr(2, 5)}`;
  }

  get symbol() {
    return SUITS[this.suit].symbol;
  }

  get color() {
    return SUITS[this.suit].color;
  }

  get displayValue() {
    return VALUE_NAMES[this.value];
  }

  flip() {
    this.faceUp = !this.faceUp;
  }
}

class Deck {
  constructor(numSuits) {
    this.cards = [];
    this.numSuits = numSuits;
    this._build();
  }

  _build() {
    // 1 naipe = 8 baralhos de 13 cartas = 104
    // 2 naipes = 4 baralhos de 26 cartas = 104
    // 4 naipes = 2 baralhos de 52 cartas = 104
    const suitsToUse = SUIT_KEYS.slice(0, this.numSuits);
    const repeats = 104 / (13 * this.numSuits);
    for (let r = 0; r < repeats; r++) {
      for (let value = 1; value <= 13; value++) {
        for (const suit of suitsToUse) {
          this.cards.push(new Card(suit, value));
        }
      }
    }
  }

  shuffle() {
    // Fisher-Yates
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
}
