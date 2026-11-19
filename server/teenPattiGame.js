// Teen Patti room engine adapted from the supplied Fun Holdem server structure.
// Server-authoritative, 3 cards per player, virtual practice chips only.
'use strict';

const { evaluateHand, compareHands } = require('./handEvaluator');
const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

class TeenPattiGame {
  constructor(roomId, maxPlayers = 6, options = {}) {
    this.roomId = roomId;
    this.maxPlayers = Math.min(6, Math.max(2, maxPlayers));
    this.startingChips = options.startingChips || 10000;
    this.bootAmount = options.bootAmount || 10;
    this.players = [];
    this.deck = [];
    this.pot = 0;
    this.phase = 'waiting';
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.handNumber = 0;
    this.lastAction = null;
    this.winnerIds = [];
  }

  addPlayer(id, name) {
    if (!id || this.players.length >= this.maxPlayers || this.players.some(p => p.id === id)) return false;
    this.players.push({
      id, name: name || 'Player ' + (this.players.length + 1),
      chips: this.startingChips, cards: [], bet: 0,
      folded: false, seen: false, packed: false, seat: this.players.length,
      lastHand: null, action: 'waiting'
    });
    return true;
  }

  removePlayer(id) {
    const index = this.players.findIndex(p => p.id === id);
    if (index < 0) return false;
    this.players.splice(index, 1);
    this.players.forEach((p, i) => p.seat = i);
    if (this.players.length) {
      this.dealerIndex %= this.players.length;
      this.currentPlayerIndex %= this.players.length;
    } else {
      this.dealerIndex = 0;
      this.currentPlayerIndex = 0;
      this.phase = 'waiting';
    }
    return true;
  }

  createDeck() {
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push(rank + suit);
    return deck;
  }

  shuffle() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  startHand() {
    if (this.players.filter(p => p.chips > 0).length < 2) return false;
    this.handNumber++;
    this.deck = this.createDeck();
    this.shuffle();
    this.pot = 0;
    this.winnerIds = [];
    this.lastAction = null;
    this.phase = 'playing';
    this.players.forEach(p => {
      p.cards = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
      p.bet = 0; p.folded = p.chips <= 0; p.packed = p.chips <= 0;
      p.seen = false; p.lastHand = null; p.action = 'waiting';
    });
    this.players.forEach(p => {
      if (!p.folded) this.collect(p, this.bootAmount);
    });
    this.currentPlayerIndex = this.nextActiveIndex(this.dealerIndex);
    this.finishIfOneLeft();
    return true;
  }

  collect(player, amount) {
    const paid = Math.min(player.chips, Math.max(0, amount));
    player.chips -= paid;
    player.bet += paid;
    this.pot += paid;
    return paid;
  }

  activePlayers() {
    return this.players.filter(p => !p.folded && !p.packed);
  }

  nextActiveIndex(from) {
    if (!this.players.length) return 0;
    for (let step = 1; step <= this.players.length; step++) {
      const i = (from + step) % this.players.length;
      if (!this.players[i].folded && !this.players[i].packed) return i;
    }
    return from;
  }

  currentPlayer() {
    return this.players[this.currentPlayerIndex] || null;
  }

  act(id, action, amount = 0) {
    if (this.phase !== 'playing') return { ok: false, error: 'No hand is currently active' };
    const player = this.players.find(p => p.id === id);
    if (!player || player.id !== this.currentPlayer()?.id || player.folded || player.packed) {
      return { ok: false, error: 'It is not this player’s turn' };
    }
    const kind = String(action).toLowerCase();
    if (kind === 'pack' || kind === 'fold') {
      player.folded = true; player.packed = true; player.action = 'Pack';
    } else if (kind === 'blind') {
      if (player.seen) return { ok: false, error: 'Seen players cannot play blind' };
      const paid = this.collect(player, Math.max(this.bootAmount, Number(amount) || this.bootAmount));
      player.action = 'Blind'; this.lastAction = { playerId: id, action: 'Blind', paid };
    } else if (kind === 'chaal' || kind === 'call' || kind === 'seen') {
      player.seen = true;
      const paid = this.collect(player, Math.max(this.bootAmount * 2, Number(amount) || this.bootAmount * 2));
      player.action = 'Chaal'; this.lastAction = { playerId: id, action: 'Chaal', paid };
    } else if (kind === 'show') {
      if (this.activePlayers().length !== 2) return { ok: false, error: 'Show is available only when two players remain' };
      const opponent = this.activePlayers().find(p => p.id !== id);
      const result = compareHands(evaluateHand(player.cards), evaluateHand(opponent.cards));
      const winner = result >= 0 ? player : opponent;
      this.award(winner);
      return { ok: true, state: this.getPublicState(id) };
    } else if (kind === 'sideshow') {
      if (!player.seen || this.activePlayers().length !== 2) return { ok: false, error: 'Side Show requires a seen player and exactly two active players' };
      const opponent = this.activePlayers().find(p => p.id !== id);
      if (!opponent.seen) return { ok: false, error: 'Opponent must have seen their cards' };
      const result = compareHands(evaluateHand(player.cards), evaluateHand(opponent.cards));
      const loser = result < 0 ? player : opponent;
      loser.folded = true; loser.packed = true; loser.action = 'Side Show lost';
    } else {
      return { ok: false, error: 'Unsupported Teen Patti action' };
    }

    this.finishIfOneLeft();
    if (this.phase === 'playing') this.currentPlayerIndex = this.nextActiveIndex(this.currentPlayerIndex);
    return { ok: true, state: this.getPublicState(id) };
  }

  finishIfOneLeft() {
    const active = this.activePlayers();
    if (active.length === 1) this.award(active[0]);
    else if (active.length === 0) { this.phase = 'showdown'; }
  }

  award(winner) {
    if (!winner || this.phase === 'showdown') return;
    winner.chips += this.pot;
    winner.lastHand = evaluateHand(winner.cards);
    this.winnerIds = [winner.id];
    this.pot = 0;
    this.phase = 'showdown';
    this.dealerIndex = this.players.length ? (this.dealerIndex + 1) % this.players.length : 0;
  }

  prepareNextHand() {
    if (this.players.filter(p => p.chips > 0).length < 2) return false;
    this.phase = 'waiting';
    return true;
  }

  getPublicState(forPlayerId = null) {
    return {
      roomId: this.roomId, phase: this.phase, pot: this.pot,
      currentPlayerId: this.phase === 'playing' ? this.currentPlayer()?.id || null : null,
      dealerIndex: this.dealerIndex, handNumber: this.handNumber,
      bootAmount: this.bootAmount, lastAction: this.lastAction,
      winnerIds: this.winnerIds,
      players: this.players.map(p => ({
        id: p.id, name: p.name, chips: p.chips, bet: p.bet,
        folded: p.folded, packed: p.packed, seen: p.seen, seat: p.seat,
        isDealer: this.players.indexOf(p) === this.dealerIndex,
        cards: p.id === forPlayerId || (this.phase === 'showdown' && !p.folded) ? p.cards : (p.folded ? [] : ['back','back','back']),
        lastHand: p.lastHand
      }))
    };
  }
}

module.exports = TeenPattiGame;
