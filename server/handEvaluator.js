// Teen Patti hand evaluator adapted from the supplied Fun Holdem engine.
// Three-card ranking: Trail > Pure Sequence > Sequence > Color > Pair > High Card.
'use strict';
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
function parseCard(card) {
  if (typeof card !== 'string' || card.length !== 2) throw new TypeError('Invalid card: ' + card);
  const rank = RANKS.indexOf(card[0].toUpperCase());
  const suit = card[1].toLowerCase();
  if (rank < 0 || !SUITS.includes(suit)) throw new TypeError('Invalid card: ' + card);
  return { rank, suit, code: card[0].toUpperCase() + suit };
}
function sequenceHigh(ranks) {
  const u = [...new Set(ranks)].sort((a,b) => b-a);
  if (u.length !== 3) return -1;
  if (u[0] === 12 && u[1] === 11 && u[2] === 10) return 14; // A-K-Q
  if (u[0] === 12 && u[1] === 1 && u[2] === 0) return 13; // A-2-3
  if (u[0] - u[2] === 2) return u[0] + 2;
  return -1;
}
function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new TypeError('Teen Patti hand must contain exactly 3 cards');
  const parsed = cards.map(parseCard);
  if (new Set(parsed.map(c => c.code)).size !== 3) throw new Error('A hand cannot contain duplicate cards');
  const ranks = parsed.map(c => c.rank).sort((a,b) => b-a);
  const sameSuit = parsed.every(c => c.suit === parsed[0].suit);
  const counts = new Map();
  ranks.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  const countValues = [...counts.values()].sort((a,b) => b-a);
  const seq = sequenceHigh(ranks);
  let category, name, tiebreak;
  if (countValues[0] === 3) { category=6; name='Trail'; tiebreak=[ranks[0]]; }
  else if (seq >= 0 && sameSuit) { category=5; name='Pure Sequence'; tiebreak=[seq]; }
  else if (seq >= 0) { category=4; name='Sequence'; tiebreak=[seq]; }
  else if (sameSuit) { category=3; name='Color'; tiebreak=ranks; }
  else if (countValues[0] === 2) {
    category=2; name='Pair';
    const pairRank=[...counts.entries()].find(x => x[1] === 2)[0];
    const kicker=[...counts.entries()].find(x => x[1] === 1)[0];
    tiebreak=[pairRank,kicker];
  } else { category=1; name='High Card'; tiebreak=ranks; }
  return { category, rank:category, name, tiebreak, cards:parsed.map(c => c.code) };
}
function compareHands(handA, handB) {
  const a=Array.isArray(handA)?evaluateHand(handA):handA;
  const b=Array.isArray(handB)?evaluateHand(handB):handB;
  if (!a || !b || !Array.isArray(a.tiebreak) || !Array.isArray(b.tiebreak)) throw new TypeError('Expected evaluated hands or 3-card arrays');
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  for (let i=0;i<Math.max(a.tiebreak.length,b.tiebreak.length);i++) {
    const av=a.tiebreak[i] ?? -1, bv=b.tiebreak[i] ?? -1;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}
module.exports={evaluateHand,compareHands};
