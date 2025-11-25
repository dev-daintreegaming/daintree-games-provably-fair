class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

const DIAMONDS_GEM_TYPE = [
  "GEM_1",
  "GEM_2",
  "GEM_3",
  "GEM_4",
  "GEM_5",
  "GEM_6",
  "GEM_7",
];

const DIAMONDS_GEM_TYPE_TO_GEM_COLOR_MAP = {
  GEM_1: "#4CAF50", // green
  GEM_2: "#2196F3", // blue
  GEM_3: "#FF9800", // orange
  GEM_4: "#F44336", // red
  GEM_5: "#FFEB3B", // yellow
  GEM_6: "#E91E63", // magenta/pink
  GEM_7: "#9C27B0", // purple
};

class RoundSettler {
  static SHA512_HASH_LENGTH = 128;
  static DIAMONDS_COUNT = 5;
  static HEX_CHARS_PER_DIAMOND = Math.floor(this.SHA512_HASH_LENGTH / this.DIAMONDS_COUNT); // 25

  /** 
   * Algorithm:
   * 1. Split hash into DIAMONDS_COUNT chunks (each HEX_CHARS_PER_DIAMOND characters)
   * 2. For each chunk, take first 8 hex characters
   * 3. Convert to decimal number
   * 4. Use modulo to get diamond type index
   */
  static generateDiamondsFromHash(hash) {
    if (hash.length !== this.SHA512_HASH_LENGTH) {
      throw new Error(`Invalid hash size: ${hash.length}. It should be equal to ${this.SHA512_HASH_LENGTH}`);
    }

    const totalTypes = DIAMONDS_GEM_TYPE.length;

    return Array.from({ length: this.DIAMONDS_COUNT }, (_, index) => {
      const startIndex = index * this.HEX_CHARS_PER_DIAMOND;
      const endIndex = (index + 1) * this.HEX_CHARS_PER_DIAMOND;
      const chunk = hash.substring(startIndex, endIndex);

      // Take first 8 hex characters from chunk
      const hexSample = chunk.substring(0, 8);
      const number = parseInt(hexSample, 16);
      const diamondIndex = number % totalTypes;

      return DIAMONDS_GEM_TYPE[diamondIndex];
    });
  }

  static getData(serverSeed, nonce, clientSeed) {
    const message = `${clientSeed}:${nonce}`;
    const hash = ShaUtils.hmacSha512(message, serverSeed).toString();

    const diamonds = this.generateDiamondsFromHash(hash);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      hash,
      diamonds
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  diamonds: null,
  hash: ''
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.hash = '';
    appState.diamonds = null;
    renderResults();
    return;
  }

  try {
    const data = RoundSettler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);
    appState.sha256 = data.sha256;
    appState.hash = data.hash;
    appState.diamonds = data.diamonds;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.hash = '';
    appState.diamonds = null;
  }

  renderResults();
}

function createDiamondElement(diamondType, index) {
  const diamondDiv = document.createElement('div');
  diamondDiv.className = 'diamond';
  
  const color = DIAMONDS_GEM_TYPE_TO_GEM_COLOR_MAP[diamondType] || 'gray';
  diamondDiv.style.backgroundColor = color;
  diamondDiv.setAttribute('data-gem-type', diamondType);
  diamondDiv.setAttribute('data-gem-color', color);
  
  diamondDiv.textContent = `${index + 1}. ${diamondType}`;
  return diamondDiv;
}

function createResultRow(diamonds, hash) {
  const resultWrapper = document.createElement('div');
  resultWrapper.className = 'result-wrapper';

  const diamondsContainer = document.createElement('div');
  diamondsContainer.className = 'diamonds-container';
  
  diamonds.forEach((diamond, index) => {
    const diamondElement = createDiamondElement(diamond, index);
    diamondsContainer.appendChild(diamondElement);
  });

  const hashDiv = document.createElement('div');
  hashDiv.className = 'hash-part';
  hashDiv.textContent = hash;

  resultWrapper.appendChild(diamondsContainer);
  resultWrapper.appendChild(hashDiv);

  return resultWrapper;
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  if (sha256Input) {
    sha256Input.value = appState.sha256;
  }

  const resultsContainer = document.getElementById('results-container');

  if (appState.diamonds === null) {
    resultsContainer.style.display = 'none';
    return;
  }

  resultsContainer.style.display = 'flex';
  const resultsWrapper = document.getElementById('results-wrapper');

  resultsWrapper.innerHTML = '';

  const helperText = document.createElement('div');
  helperText.className = 'helper-text';

  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `
    <h4>Diamonds are calculated following these steps:</h4>
    <div><b>Step 1:</b> Calculate <strong>HMAC-SHA512</strong> of message "clientSeed:nonce" with key serverSeed</div>
    <div><b>Step 2:</b> Split hash into <strong>${RoundSettler.DIAMONDS_COUNT} chunks</strong> (each ${RoundSettler.HEX_CHARS_PER_DIAMOND} hex characters)</div>
    <div><b>Step 3:</b> For each chunk, take first <strong>8 hex characters</strong></div>
    <div><b>Step 4:</b> Convert hex to decimal number</div>
    <div><b>Step 5:</b> Calculate <strong>diamondIndex = number % totalTypes</strong></div>
    <div><b>Step 6:</b> Get diamond type from <strong>DIAMONDS_GEM_TYPE[diamondIndex]</strong></div>
  `;

  helperText.appendChild(step);

  resultsWrapper.appendChild(helperText);

  const resultRow = createResultRow(appState.diamonds, appState.hash);
  resultsWrapper.appendChild(resultRow);
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

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
