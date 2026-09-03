class ShaUtils {
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

class MolesShuffler {
  static SHA256_HASH_LENGTH = 64;

  static HOLE_COUNT = 7;
  static DECIMALS_USED = 4;

  static K_POW_1 = 16;
  static K_POW_2 = 16 * 16;
  static K_POW_3 = 16 * 16 * 16;
  static K_POW_4 = 16 * 16 * 16 * 16;

  // A game lasts up to 8 rounds (1 mole) or 9 rounds (2-6 moles).
  static getRoundCount(molesCount) {
    return molesCount === 1 ? 8 : 9;
  }

  static getData(serverSeed, nonce, clientSeed, molesCount) {
    const roundCount = this.getRoundCount(molesCount);
    const hashes = this.calculateHashes(serverSeed, clientSeed, nonce, roundCount);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      hashes,
      molePositions: this.getMolePositions(hashes, molesCount),
    };
  }

  // New positions are generated each round: hmacSha256("clientSeed:nonce:round", serverSeed).
  static calculateHashes(serverSeed, clientSeed, nonce, roundCount) {
    const hashes = [];

    for (let round = 0; round < roundCount; round++) {
      const message = `${clientSeed}:${nonce}:${round}`;
      hashes.push(ShaUtils.hmacSha256(message, serverSeed).toString());
    }

    return hashes;
  }

  // For each round takes the first `molesCount` positions (0..6) where moles are hidden.
  static getMolePositions(hashes, molesCount) {
    return hashes.map((hash) => this.calculatePosition(hash).slice(0, molesCount));
  }

  // Shuffles the 7 hole positions (0..6) using the provided hash.
  static calculatePosition(hash) {
    if (hash.length !== this.SHA256_HASH_LENGTH) {
      throw new Error(`Invalid hash size: ${hash.length}. It should be equal to ${this.SHA256_HASH_LENGTH}`);
    }

    return Array.from(hash.slice(0, this.HOLE_COUNT * this.DECIMALS_USED))
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
      .map((decimals, index) => ({ index, rate: this.calculateRate(decimals) }))
      .sort((a, b) => a.rate - b.rate)
      .map(({ index }) => index);
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

// Whack-a-mole schematic: 7 holes over 3 rows (2 / 3 / 2).
const HOLE_ROWS = [[0, 1], [2, 3, 4], [5, 6]];

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  molesCount: 3,
  sha256: '',
  hashes: [],
  molePositions: [],
  selectedRound: 0,
  showExplanation: true,
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.hashes = [];
    appState.molePositions = [];
    renderResults();
    return;
  }

  try {
    const data = MolesShuffler.getData(
      appState.serverSeed,
      appState.nonce,
      appState.clientSeed,
      appState.molesCount,
    );

    appState.sha256 = data.sha256;
    appState.hashes = data.hashes;
    appState.molePositions = data.molePositions;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.hashes = [];
    appState.molePositions = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  sha256Input.value = appState.sha256;

  renderRounds();
  renderExplanation();
}

function renderRounds() {
  const roundsContainer = document.getElementById('rounds-container');

  if (!appState.molePositions.length) {
    roundsContainer.innerHTML = '';
    return;
  }

  roundsContainer.innerHTML = appState.molePositions
    .map((positions, round) => {
      const moleSet = new Set(positions);
      const isSelected = appState.selectedRound === round;

      const boardHTML = HOLE_ROWS
        .map((row) => `
          <div class="mole-row">
            ${row
              .map((hole) => `
                <div class="hole ${moleSet.has(hole) ? 'mole' : 'empty'}">${hole}</div>
              `)
              .join('')}
          </div>
        `)
        .join('');

      return `
        <div class="round-card ${isSelected ? 'selected' : ''}" onclick="selectRound(${round})">
          <div class="round-label">Round ${round + 1}</div>
          <div class="mole-board">${boardHTML}</div>
          <div class="round-positions">[ ${positions.join(', ')} ]</div>
        </div>
      `;
    })
    .join('');
}

function selectRound(round) {
  appState.selectedRound = round;
  appState.showExplanation = true;
  renderRounds();
  renderExplanation();
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');

  if (
    appState.selectedRound === null ||
    !appState.hashes.length ||
    appState.hashes.length <= appState.selectedRound
  ) {
    explanationContainer.innerHTML = '';
    return;
  }

  if (!appState.showExplanation) {
    explanationContainer.innerHTML = `
      <div class="toggle-explanation">
        <button class="button" onclick="showExplanation()">
          Show Explanation
        </button>
      </div>
    `;
    return;
  }

  const round = appState.selectedRound;
  const hash = appState.hashes[round] || '';

  const hexChars = hash.slice(0, MolesShuffler.HOLE_COUNT * MolesShuffler.DECIMALS_USED).split('');

  const hexGroups = [];
  for (let i = 0; i < hexChars.length; i += MolesShuffler.DECIMALS_USED) {
    hexGroups.push(hexChars.slice(i, i + MolesShuffler.DECIMALS_USED));
  }

  const powers = [
    MolesShuffler.K_POW_1,
    MolesShuffler.K_POW_2,
    MolesShuffler.K_POW_3,
    MolesShuffler.K_POW_4,
  ];

  const groupsWithRates = hexGroups.map((group, index) => {
    const decimals = group.map((c) => parseInt(c, 16));
    const rate = decimals.reduce((acc, decimal, decimalIndex) => acc + decimal / powers[decimalIndex], 0);

    return { index, hex: group.join(''), decimals, rate };
  });

  const sortedGroups = [...groupsWithRates].sort((a, b) => a.rate - b.rate);
  const positions = sortedGroups.map((g) => g.index);
  const molePositions = positions.slice(0, appState.molesCount);
  const moleSet = new Set(molePositions);

  const explanationHTML = `
    <div class="calculation-explanation">
      <h3>Explanation for Round ${round + 1}</h3>

      <div class="round-explanation">
        <div class="explanation-step">
          <h4>Step 1: Get HMAC-SHA256 for the round</h4>
          <p>We use the client seed, nonce, and round number to create a hash:</p>
          <pre>hmacSha256("${appState.clientSeed}:${appState.nonce}:${round}", "${appState.serverSeed}") = ${hash}</pre>
        </div>

        <div class="explanation-step">
          <h4>Step 2: Take the first ${MolesShuffler.HOLE_COUNT} groups of ${MolesShuffler.DECIMALS_USED} characters (one per hole)</h4>
          ${hexGroups
            .map((group, idx) => `
              <div class="hex-group">
                <strong>Hole ${idx}:</strong> ${group.join('')} (hex values: <b>${group.map((c) => parseInt(c, 16)).join(', ')}</b>)
              </div>
            `)
            .join('')}
        </div>

        <div class="explanation-step">
          <h4>Step 3: Calculate rate for each hole</h4>
          ${groupsWithRates
            .map((group) => `
              <div class="rate-calculation">
                <strong>Hole ${group.index}:</strong> rate =
                ${group.decimals
                  .map((decimal, decimalIdx) => ` ${decimal} / ${powers[decimalIdx]}${decimalIdx < group.decimals.length - 1 ? ' +' : ''}`)
                  .join('')} = <b>${group.rate.toFixed(12)}</b>
              </div>
            `)
            .join('')}
        </div>

        <div class="explanation-step">
          <h4>Step 4: Sort holes ascending by rate</h4>
          <p>Sorted rates: ${sortedGroups.map((group) => group.rate.toFixed(12)).join(', ')}</p>
          <p>Order of holes: <strong>${positions.join(', ')}</strong></p>
        </div>

        <div class="explanation-step">
          <h4>Step 5: Take the first ${appState.molesCount} position(s) — these hold moles</h4>
          <div class="base-row-container">
            ${positions
              .map((pos) => `
                <span class="base-row-item">
                  <span class="item-index">${pos}</span>
                  <span class="item-value ${moleSet.has(pos) ? 'item-mole' : ''}">${moleSet.has(pos) ? 'mole' : 'empty'}</span>
                </span>
              `)
              .join('')}
          </div>
          <p>Mole positions: <strong>[ ${molePositions.join(', ')} ]</strong></p>
        </div>
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

function handleMolesCountChange(event) {
  appState.molesCount = parseInt(event.target.value, 10);
  updateResults();
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const molesCountSelect = document.getElementById('moles-count-select');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);
  molesCountSelect.addEventListener('change', handleMolesCountChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
