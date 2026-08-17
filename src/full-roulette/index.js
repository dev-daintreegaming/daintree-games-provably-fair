const ROULETTE_COLOR = {
  GREEN: "GREEN",
  RED: "RED",
  BLACK: "BLACK",
};

// Single-zero European wheel: 37 pockets (0 + 1..36).
const ROULETTE_NUMBERS = 37;

// First 13 hex chars = 52 bits — fits safely in a JS double (max safe int is 2^53 − 1).
const GAME_NUMBER_HEX_LENGTH = 13;

// Standard single-zero European wheel red pockets; everything else in 1..36 is black, 0 is green.
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

class RoundSettler {
  static SALT = "00000000000000000002f0ce8e67d4a43863ceb94629ba25436be26452ef1650";
  static HMACSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
  static hexEncoder = CryptoJS.enc.Hex;

  static getResult(hash) {
    const salted = this.saltHash(hash);

    const number = this.getIntResultFromHash(salted);

    return {
      color: this.getColor(number),
      number,
      hash,
    };
  }

  static getColor(number) {
    if (number === 0) {
      return ROULETTE_COLOR.GREEN;
    }

    return RED_NUMBERS.has(number) ? ROULETTE_COLOR.RED : ROULETTE_COLOR.BLACK;
  }

  static getPreviousHash(hash) {
    return RoundSettler.sha256(RoundSettler.hexEncoder.parse(hash)).toString();
  }

  static getIntResultFromHash(hash) {
    const num = parseInt(hash.substring(0, GAME_NUMBER_HEX_LENGTH), 16);

    return num % ROULETTE_NUMBERS;
  }

  static saltHash(hash, key = RoundSettler.SALT) {
    const hmac = RoundSettler.HMACSha256(hash, key);

    return hmac.toString(RoundSettler.hexEncoder);
  }
}

let appState = {
  hash: '',
  limit: 50,
  results: []
};

function getColorClassName(color) {
  if (color === ROULETTE_COLOR.GREEN) {
    return "color-green";
  }

  if (color === ROULETTE_COLOR.RED) {
    return "color-red";
  }

  if (color === ROULETTE_COLOR.BLACK) {
    return "color-black";
  }

  return "";
}

function createColorRow(hash, color, number) {
  const colorWrapper = document.createElement('div');
  colorWrapper.className = 'color-wrapper';

  const hashDiv = document.createElement('div');
  hashDiv.className = 'hash-wrapper'
  hashDiv.textContent = hash;

  const numberDiv = document.createElement('div');
  numberDiv.className = `color ${getColorClassName(color)}`;
  numberDiv.textContent = number;

  colorWrapper.appendChild(hashDiv);
  colorWrapper.appendChild(numberDiv);

  return colorWrapper;
}

function renderResults() {
  const resultsContainer = document.getElementById('results-container');

  if (appState.results.length === 0) {
    resultsContainer.style.display = 'none';
    return;
  }

  resultsContainer.style.display = 'flex';
  const resultsWrapper = document.getElementById('results-wrapper');

  resultsWrapper.innerHTML = '';

  appState.results.forEach(result => {
    const colorRow = createColorRow(result.hash, result.color, result.number);
    resultsWrapper.appendChild(colorRow);
  });

  const showMoreButton = document.createElement('button');
  showMoreButton.textContent = 'Show more';
  showMoreButton.onclick = handleShowMore;
  resultsWrapper.appendChild(showMoreButton);
}

function calculateResults() {
  const results = [];
  let closuredHash = appState.hash;

  for (let i = 0; i < appState.limit; i++) {
    results.push(RoundSettler.getResult(closuredHash));

    closuredHash = RoundSettler.getPreviousHash(closuredHash);
  }

  appState.results = results;
  renderResults();
}

function handleHashChange(event) {
  appState.hash = event.target.value;

  if (!appState.hash) {
    appState.results = [];
    appState.limit = 50;
    renderResults();
    return;
  }

  calculateResults();
}

function handleShowMore() {
  appState.limit += 50;
  calculateResults();
}

function initApp() {
  const hashInput = document.getElementById('hash-input');
  hashInput.addEventListener('input', handleHashChange);
}

document.addEventListener('DOMContentLoaded', initApp);
