class ShaUtils {
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

const CARD_SUITS = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
const CARD_RANKS = ['TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'JACK', 'QUEEN', 'KING', 'ACE'];

class DeckGenerator {
  static get DECK_SIZE() { return 52; }
  static get DECIMALS_PER_CARD() { return 4; }
  static get SHA256_HASH_LENGTH() { return 64; }
  static get HASHES_COUNT_PER_DECK() { 
    return DeckGenerator.DECIMALS_PER_CARD * DeckGenerator.DECK_SIZE / DeckGenerator.SHA256_HASH_LENGTH;
  }
  static get POWERS_OF_16() {
    return [16, 16 * 16, 16 * 16 * 16, 16 * 16 * 16 * 16];
  }

  static getDeck(hash, deckCount = 4) {
    if (hash.length !== DeckGenerator.SHA256_HASH_LENGTH) {
      throw new Error(`Invalid hash size. It should be equal to ${DeckGenerator.SHA256_HASH_LENGTH}`);
    }

    const deck = DeckGenerator.generateDecks(deckCount);
    const hashes = DeckGenerator.generateHashes(hash, deckCount);
    return DeckGenerator.getRanks(hashes, deckCount).map(index => deck[index]);
  }

  static getRanks(hashes, deckCount) {
    const joinedHashes = hashes.join('');
    const decimals = joinedHashes
      .slice(0, deckCount * DeckGenerator.DECK_SIZE * DeckGenerator.DECIMALS_PER_CARD)
      .split('')
      .map(char => parseInt(char, 16));

    const chunks = [];
    for (let i = 0; i < decimals.length; i += DeckGenerator.DECIMALS_PER_CARD) {
      chunks.push(decimals.slice(i, i + DeckGenerator.DECIMALS_PER_CARD));
    }

    const indexedRates = chunks.map((chunk, index) => ({
      index,
      rate: DeckGenerator.calculateRate(chunk)
    }));

    return indexedRates
      .sort((a, b) => a.rate - b.rate)
      .map(item => item.index);
  }

  static calculateRate(decimals) {
    return decimals.reduce((acc, decimal, index) => {
      return acc + decimal * 1.0 / DeckGenerator.POWERS_OF_16[index];
    }, 0.0);
  }

  static generateHashes(hash, deckCount) {
    const hashesCount = Math.ceil(DeckGenerator.HASHES_COUNT_PER_DECK * deckCount);
    const hashes = [];
    for (let i = 1; i <= hashesCount; i++) {
      hashes.push(DeckGenerator.sha256(`${hash}:${i}`));
    }
    return hashes;
  }

  static sha256(input) {
    return ShaUtils.sha256(input).toString();
  }

  static generateDecks(count) {
    const cards = [];
    for (let deckNumber = 0; deckNumber < count; deckNumber++) {
      CARD_SUITS.forEach(suit => {
        CARD_RANKS.forEach(rank => {
          cards.push({
            suit: suit,
            rank: rank,
            deck: deckNumber.toString()
          });
        });
      });
    }
    return cards;
  }
}

class BlackjackDealer {
  static dealInitialHands(cards, seatsAmount) {
    const hands = {
      players: [],
      dealer: []
    };

    // Initialize player hands
    for (let i = 0; i < seatsAmount; i++) {
      hands.players.push([]);
    }

    // Deal initial 2 cards to each player and dealer
    let cardIndex = 0;
    
    // First card to each player, then dealer
    for (let i = 0; i < seatsAmount; i++) {
      hands.players[i].push(cards[cardIndex++]);
    }
    hands.dealer.push(cards[cardIndex++]);

    // Second card to each player, then dealer
    for (let i = 0; i < seatsAmount; i++) {
      hands.players[i].push(cards[cardIndex++]);
    }
    hands.dealer.push(cards[cardIndex++]);

    return hands;
  }

  static formatCard(card) {
    const suit = card.suit;
    const rank = card.rank;
    
    let displayRank = rank;
    if (rank === 'JACK') displayRank = 'J';
    else if (rank === 'QUEEN') displayRank = 'Q';
    else if (rank === 'KING') displayRank = 'K';
    else if (rank === 'ACE') displayRank = 'A';
    else if (rank === 'TEN') displayRank = '10';
    else {
      const rankMap = {
        'TWO': '2', 'THREE': '3', 'FOUR': '4', 'FIVE': '5',
        'SIX': '6', 'SEVEN': '7', 'EIGHT': '8', 'NINE': '9'
      };
      displayRank = rankMap[rank] || rank;
    }

    const suitSymbols = {
      'HEARTS': '♥',
      'DIAMONDS': '♦',
      'CLUBS': '♣',
      'SPADES': '♠'
    };

    const cardElement = document.createElement('div');
    cardElement.className = `card ${suit === 'HEARTS' || suit === 'DIAMONDS' ? 'red' : 'black'}`;

    const cardTextElement1 = document.createElement('div');
    cardTextElement1.className = 'card-text';
    const rankElement1 = document.createElement('div');
    rankElement1.textContent = displayRank;
    const suitElement1 = document.createElement('div');
    suitElement1.textContent = suitSymbols[suit];
    cardTextElement1.appendChild(rankElement1);
    cardTextElement1.appendChild(suitElement1);

    const cardTextElement2 = document.createElement('div');
    cardTextElement2.className = 'card-text';
    const rankElement2 = document.createElement('div');
    rankElement2.textContent = displayRank;
    const suitElement2 = document.createElement('div');
    suitElement2.textContent = suitSymbols[suit];
    cardTextElement2.appendChild(rankElement2);
    cardTextElement2.appendChild(suitElement2);

    cardElement.appendChild(cardTextElement1);
    cardElement.appendChild(cardTextElement2);

    return cardElement;
  }
}

class RoundSettler {
  static compute(hash) {
    return DeckGenerator.getDeck(hash);
  }
    
  static getData(serverSeed, nonce, clientSeed) {
    const sha256Hmac = ShaUtils.hmacSha256(`${clientSeed}:${nonce}`, serverSeed).toString();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha256Hmac,
      cards: this.compute(sha256Hmac),
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  seatsAmount: 3,
  sha256: '',
  sha256Hmac: '',
  cards: null,
  blackjackHands: null
};

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.cards = null;
    appState.blackjackHands = null;
    renderResults();
    return;
  }

  try {
    const data = RoundSettler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);

    appState.sha256 = data.sha256;
    appState.sha256Hmac = data.sha256Hmac;
    appState.cards = data.cards;
    appState.blackjackHands = BlackjackDealer.dealInitialHands(data.cards, appState.seatsAmount);
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.cards = null;
    appState.blackjackHands = null;
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha256HmacInput = document.getElementById('sha256-hmac-input');
  const blackjackTitleDiv = document.getElementById('blackjack-title');
  const blackjackHandsDiv = document.getElementById('blackjack-hands');
  const fullDeckSection = document.getElementById('full-deck-section');
  
  sha256Input.value = appState.sha256;
  sha256HmacInput.value = appState.sha256Hmac;
  
  if (appState.blackjackHands !== null && appState.cards !== null) {
    renderBlackjackTitle(blackjackTitleDiv);
    renderBlackjackHands(blackjackHandsDiv, appState.blackjackHands);
    renderFullDeck(fullDeckSection, appState.cards);
  } else {
    blackjackTitleDiv.innerHTML = '';
    blackjackHandsDiv.innerHTML = '';
    fullDeckSection.innerHTML = '';
  }
}

function renderBlackjackTitle(container) {
  container.innerHTML = '';
  
  const title = document.createElement('div');
  title.className = 'text';
  title.textContent = `This is the starting hand for each seat (${appState.seatsAmount} seats) and dealer from the deck, generated from sha256Hmac(clientSeed:nonce, serverSeed) hash:`;
  
  container.appendChild(title);
}

function renderFullDeck(container, cards) {
  container.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'full-deck-title';
  title.textContent = 'This is the full deck, generated from sha256Hmac(clientSeed:nonce, serverSeed) hash:';

  const expandButton = document.createElement('button');
  expandButton.className = 'expand-button';
  expandButton.textContent = 'Show Full Deck (208 cards)';
  
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'full-deck-cards';
  
  cards.forEach(card => {
    const cardElement = BlackjackDealer.formatCard(card);
    cardsContainer.appendChild(cardElement);
  });

  let isExpanded = false;
  expandButton.addEventListener('click', () => {
    isExpanded = !isExpanded;
    if (isExpanded) {
      cardsContainer.classList.add('expanded');
      expandButton.textContent = 'Hide Full Deck';
    } else {
      cardsContainer.classList.remove('expanded');
      expandButton.textContent = 'Show Full Deck (208 cards)';
    }
  });

  container.appendChild(title);
  container.appendChild(expandButton);
  container.appendChild(cardsContainer);
}

function renderBlackjackHands(container, hands) {
  container.innerHTML = '';

  hands.players.forEach((playerHand, index) => {
    const playerSection = document.createElement('div');
    playerSection.className = 'hand-section player-section';
    
    const playerTitle = document.createElement('div');
    playerTitle.className = 'hand-title';
    playerTitle.textContent = `Seat ${index + 1}`;
    
    const playerCards = document.createElement('div');
    playerCards.className = 'hand-cards';
    
    playerHand.forEach(card => {
      const cardElement = BlackjackDealer.formatCard(card);
      playerCards.appendChild(cardElement);
    });
    
    playerSection.appendChild(playerTitle);
    playerSection.appendChild(playerCards);
    container.appendChild(playerSection);
  });

  const dealerSection = document.createElement('div');
  dealerSection.className = 'hand-section dealer-section';

  const dealerTitle = document.createElement('div');
  dealerTitle.className = 'hand-title';
  dealerTitle.textContent = 'Dealer';

  const dealerCards = document.createElement('div');
  dealerCards.className = 'hand-cards';

  hands.dealer.forEach(card => {
    const cardElement = BlackjackDealer.formatCard(card);
    dealerCards.appendChild(cardElement);
  });

  dealerSection.appendChild(dealerTitle);
  dealerSection.appendChild(dealerCards);
  container.appendChild(dealerSection);
}

function handleServerSeedChange(event) {
  appState.serverSeed = event.target.value;
  updateResults();
}

function handleNonceChange(event) {
  appState.nonce = event.target.value;
  updateResults();
}

function handleClientSeedChange(event) {
  appState.clientSeed = event.target.value;
  updateResults();
}

function handleSeatsAmountChange(event) {
  appState.seatsAmount = parseInt(event.target.value);
  updateResults();
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const seatsAmountSelect = document.getElementById('seats-amount-select');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);
  seatsAmountSelect.addEventListener('change', handleSeatsAmountChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp); 