class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

class KenoDrawer {
  static BOARD_SIZE = 40;
  static DRAWN_COUNT = 10;
  static DECIMALS_USED = 4;

  // One HMAC-SHA512 hash produces 128 hex chars, but the generator needs
  // 40 * 4 = 160 chars, so two hashes are calculated and concatenated.
  static HASH_COUNT = 2;

  static K_POW_1 = 16;
  static K_POW_2 = 16 * 16;
  static K_POW_3 = 16 * 16 * 16;
  static K_POW_4 = 16 * 16 * 16 * 16;

  static getData(serverSeed, nonce, clientSeed) {
    const hashes = this.calculateHashes(serverSeed, clientSeed, nonce);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      hashes,
      drawnCells: this.getDrawnCells(hashes),
    };
  }

  // Round hashes: hmacSha512("clientSeed:nonce:i", serverSeed) for i in [0, HASH_COUNT).
  static calculateHashes(serverSeed, clientSeed, nonce) {
    const hashes = [];

    for (let i = 0; i < this.HASH_COUNT; i++) {
      const message = `${clientSeed}:${nonce}:${i}`;
      hashes.push(ShaUtils.hmacSha512(message, serverSeed).toString());
    }

    return hashes;
  }

  // Shuffles the cells (1..40) using the concatenated hashes and takes the first 10.
  static getDrawnCells(hashes) {
    const combinedHash = hashes.join('');
    const requiredLength = this.BOARD_SIZE * this.DECIMALS_USED;

    if (combinedHash.length < requiredLength) {
      throw new Error(`Invalid hash size: ${combinedHash.length}. It should be at least ${requiredLength}`);
    }

    return Array.from(combinedHash.slice(0, requiredLength))
      .map((c) => parseInt(c, 16))
      .reduce(
        (acc, curr, idx, arr) => {
          if (idx % this.DECIMALS_USED === 0) {
            acc.push(arr.slice(idx, idx + this.DECIMALS_USED));
          }

          return acc;
        },
        [],
      )
      .map((decimals, index) => ({ cell: index + 1, rate: this.calculateRate(decimals) }))
      .sort((a, b) => a.rate - b.rate)
      .slice(0, this.DRAWN_COUNT)
      .map(({ cell }) => cell);
  }

  static calculateRate(decimals) {
    return decimals.reduce(
      (acc, decimal, index) => {
        const k = (() => {
          switch (index) {
            case 0: return this.K_POW_1;
            case 1: return this.K_POW_2;
            case 2: return this.K_POW_3;
            case 3: return this.K_POW_4;
            default: throw new Error(`Invalid index ${index}, it should be less than 4`);
          }
        })();

        return acc + decimal / k;
      },
      0,
    );
  }
}

// Classic keno board: 40 numbers over 5 rows of 8.
const BOARD_COLUMNS = 8;

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  hashes: [],
  drawnCells: [],
  showExplanation: true,
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.hashes = [];
    appState.drawnCells = [];
    renderResults();
    return;
  }

  try {
    const data = KenoDrawer.getData(appState.serverSeed, appState.nonce, appState.clientSeed);

    appState.sha256 = data.sha256;
    appState.hashes = data.hashes;
    appState.drawnCells = data.drawnCells;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.hashes = [];
    appState.drawnCells = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const firstHashInput = document.getElementById('first-hash-input');
  const secondHashInput = document.getElementById('second-hash-input');

  sha256Input.value = appState.sha256;
  firstHashInput.value = appState.hashes[0] || '';
  secondHashInput.value = appState.hashes[1] || '';

  renderBoard();
  renderExplanation();
}

function renderBoard() {
  const boardContainer = document.getElementById('board-container');
  const drawnDisplay = document.getElementById('drawn-display');

  if (!appState.drawnCells.length) {
    boardContainer.innerHTML = '';
    drawnDisplay.textContent = '';
    return;
  }

  const drawnSet = new Set(appState.drawnCells);
  const rows = [];

  for (let start = 1; start <= KenoDrawer.BOARD_SIZE; start += BOARD_COLUMNS) {
    const cellsHTML = Array.from({ length: BOARD_COLUMNS }, (_, i) => {
      const cell = start + i;
      const isDrawn = drawnSet.has(cell);

      return `<div class="cell ${isDrawn ? 'drawn' : 'empty'}">${cell}</div>`;
    }).join('');

    rows.push(`<div class="board-row">${cellsHTML}</div>`);
  }

  boardContainer.innerHTML = `<div class="keno-board">${rows.join('')}</div>`;
  drawnDisplay.textContent = `[ ${appState.drawnCells.join(', ')} ]`;
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');

  if (!appState.hashes.length) {
    explanationContainer.innerHTML = '';
    return;
  }

  if (!appState.showExplanation) {
    explanationContainer.innerHTML = `
      <div class="toggle-explanation blue">
        <button class="button" onclick="showExplanation()">
          Show Explanation
        </button>
      </div>
    `;
    return;
  }

  const combinedHash = appState.hashes.join('');
  const hexChars = combinedHash.slice(0, KenoDrawer.BOARD_SIZE * KenoDrawer.DECIMALS_USED).split('');

  const hexGroups = [];
  for (let i = 0; i < hexChars.length; i += KenoDrawer.DECIMALS_USED) {
    hexGroups.push(hexChars.slice(i, i + KenoDrawer.DECIMALS_USED));
  }

  const powers = [
    KenoDrawer.K_POW_1,
    KenoDrawer.K_POW_2,
    KenoDrawer.K_POW_3,
    KenoDrawer.K_POW_4,
  ];

  const groupsWithRates = hexGroups.map((group, index) => {
    const decimals = group.map((c) => parseInt(c, 16));
    const rate = decimals.reduce((acc, decimal, decimalIndex) => acc + decimal / powers[decimalIndex], 0);

    return { cell: index + 1, hex: group.join(''), decimals, rate };
  });

  const sortedGroups = [...groupsWithRates].sort((a, b) => a.rate - b.rate);
  const drawnCells = sortedGroups.slice(0, KenoDrawer.DRAWN_COUNT).map((g) => g.cell);
  const drawnSet = new Set(drawnCells);

  const explanationHTML = `
    <div class="calculation-explanation">
      <h3>Explanation</h3>

      <div class="explanation-step">
        <h4>Step 1: Get ${KenoDrawer.HASH_COUNT} HMAC-SHA512 hashes</h4>
        <p>
          One HMAC-SHA512 hash produces 128 hex chars, but ${KenoDrawer.BOARD_SIZE} cells require
          ${KenoDrawer.BOARD_SIZE} * ${KenoDrawer.DECIMALS_USED} = ${KenoDrawer.BOARD_SIZE * KenoDrawer.DECIMALS_USED} chars,
          so two hashes are calculated and concatenated:
        </p>
        ${appState.hashes
          .map((hash, i) => `<pre>hmacSha512("${appState.clientSeed}:${appState.nonce}:${i}", "${appState.serverSeed}") = ${hash}</pre>`)
          .join('')}
      </div>

      <div class="explanation-step">
        <h4>Step 2: Split the first ${KenoDrawer.BOARD_SIZE * KenoDrawer.DECIMALS_USED} chars into ${KenoDrawer.BOARD_SIZE} groups of ${KenoDrawer.DECIMALS_USED} (one per cell) and calculate rates</h4>
        <p>rate = d1 / 16 + d2 / 256 + d3 / 4096 + d4 / 65536, where d1..d4 are the hex values of the group chars.</p>
        <div class="rates-grid">
          ${groupsWithRates
            .map((group) => `
              <div class="rate-item">
                <strong>Cell ${group.cell}:</strong>
                <span class="rate-hex">${group.hex}</span> → <b>${group.rate.toFixed(12)}</b>
              </div>
            `)
            .join('')}
        </div>
      </div>

      <div class="explanation-step">
        <h4>Step 3: Sort cells ascending by rate</h4>
        <p>Order of cells: <strong>${sortedGroups.map((g) => g.cell).join(', ')}</strong></p>
      </div>

      <div class="explanation-step">
        <h4>Step 4: Take the first ${KenoDrawer.DRAWN_COUNT} cells — these are drawn</h4>
        <div class="base-row-container">
          ${sortedGroups
            .map((group) => `
              <span class="base-row-item">
                <span class="item-value ${drawnSet.has(group.cell) ? 'item-drawn' : ''}">${group.cell}</span>
              </span>
            `)
            .join('')}
        </div>
        <p>Drawn cells: <strong>[ ${drawnCells.join(', ')} ]</strong></p>
      </div>

      <div class="toggle-explanation">
        <button class="button" onclick="hideExplanation()">
          Hide Explanation
        </button>
      </div>
    </div>
  `;

  explanationContainer.innerHTML = explanationHTML;
}

function showExplanation() {
  appState.showExplanation = true;
  renderExplanation();
}

function hideExplanation() {
  appState.showExplanation = false;
  renderExplanation();
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
