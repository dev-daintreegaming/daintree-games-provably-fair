class ShaUtils {
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

class RoundSetter {
  static SHA256_HASH_LENGTH = 64;
  static DECIMALS_PER_TILE = 4;

  static K_POW_1 = 256;
  static K_POW_2 = 256 * 256;
  static K_POW_3 = 256 * 256 * 256;
  static K_POW_4 = 256 * 256 * 256 * 256;

  static DIFFICULTIES = {
    EASY: {
      rowCount: 9,
      columnCount: 4,
      treasuresCount: 3
    },
    MEDIUM: {
      rowCount: 9,
      columnCount: 3,
      treasuresCount: 2
    },
    HARD: {
      rowCount: 9,
      columnCount: 2,
      treasuresCount: 1
    },
    EXTREME: {
      rowCount: 6,
      columnCount: 3,
      treasuresCount: 1
    },
    NIGHTMARE: {
      rowCount: 6,
      columnCount: 4,
      treasuresCount: 1
    }
  };

  static getData(serverSeed, nonce, clientSeed, difficulty = 'EASY') {
    const difficultyConfig = this.DIFFICULTIES[difficulty];
    const hashes = this.calculateHashes(serverSeed, clientSeed, nonce, difficultyConfig.rowCount);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      treasures: this.getTreasures(hashes, difficultyConfig)
    };
  }

  static calculateHashes(serverSeed, clientSeed, nonce, rowCount) {
    const hashes = [];
    
    for (let row = 0; row < rowCount; row++) {
      const message = `${clientSeed}:${nonce}:${row}`;
      const hash = ShaUtils.hmacSha256(message, serverSeed).toString();
      hashes.push(hash);
    }
    
    return hashes;
  }

  static getPositions(hash, difficulty) {
    if (hash.length !== this.SHA256_HASH_LENGTH) {
      throw new Error(`Invalid hash size: ${hash.length}. It should be equal to ${this.SHA256_HASH_LENGTH}`);
    }

    return Array.from(hash.slice(0, difficulty.columnCount * this.DECIMALS_PER_TILE))
      .map((c) => parseInt(c, 16))
      .reduce(
        (acc, curr, idx, arr) => {
          if (idx % this.DECIMALS_PER_TILE === 0) {
            acc.push(arr.slice(idx, idx + this.DECIMALS_PER_TILE));
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

  static createRow(treasuresCount, columnCount) {
    return Array(treasuresCount).fill('TREASURE').concat(Array(columnCount - treasuresCount).fill('BOMB'));
  }

  static getBoards(difficulty) {
    const { rowCount, treasuresCount, columnCount } = difficulty;
    return Array(rowCount).fill(null).map(() => this.createRow(treasuresCount, columnCount));
  }

  static getTreasures(hashes, difficulty) {
    const board = this.getBoards(difficulty);

    if (hashes.length !== difficulty.rowCount) {
      throw new Error(`Invalid hashes count: ${hashes.length}. It should be equal to ${difficulty.rowCount}`);
    }

    const rows = [];
    for (let i = 0; i < difficulty.rowCount; i++) {
      const positions = this.getPositions(hashes[i], difficulty);
      
      const row = board[i];
      rows.push(positions.map(position => row[position]));
    }
    
    return rows;
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  difficulty: 'EASY',
  sha256: '',
  treasures: [],
  hashes: [],
  selectedRow: 0,
  showExplanation: true
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.treasures = [];
    appState.hashes = [];
    renderResults();
    return;
  }

  try {
    const difficultyConfig = RoundSetter.DIFFICULTIES[appState.difficulty];
    const calculatedHashes = RoundSetter.calculateHashes(appState.serverSeed, appState.clientSeed, appState.nonce, difficultyConfig.rowCount);
    appState.hashes = calculatedHashes;

    const data = RoundSetter.getData(appState.serverSeed, appState.nonce, appState.clientSeed, appState.difficulty);
    appState.sha256 = data.sha256;
    appState.treasures = data.treasures;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.treasures = [];
    appState.hashes = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  sha256Input.value = appState.sha256;

  renderTreasuresTable();
  renderExplanation();
}

function renderTreasuresTable() {
  const tableContainer = document.getElementById('treasures-table-container');
  
  if (!appState.treasures.length) {
    tableContainer.innerHTML = '';
    return;
  }

  const difficultyConfig = RoundSetter.DIFFICULTIES[appState.difficulty];
  
  let tableHTML = `
    <table class="treasure-table">
      <thead>
        <tr>
          <th>Row</th>
          ${Array.from({ length: difficultyConfig.columnCount }).map((_, idx) => 
            `<th>Column ${idx + 1}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  [...appState.treasures].reverse().forEach((row, reversedIdx) => {
    const rowIndex = appState.treasures.length - 1 - reversedIdx;
    tableHTML += `
      <tr onclick="selectRow(${rowIndex})">
        <td class="row-label">Row ${rowIndex + 1}</td>
        ${row.map(cell => `<td>${cell}</td>`).join('')}
      </tr>
    `;
  });

  tableHTML += `
      </tbody>
    </table>
  `;

  tableContainer.innerHTML = tableHTML;
}

function selectRow(rowIndex) {
  appState.selectedRow = rowIndex;
  appState.showExplanation = true;
  renderExplanation();
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');
  
  if (appState.selectedRow === null || !appState.showExplanation || !appState.hashes || appState.hashes.length <= appState.selectedRow) {
    explanationContainer.innerHTML = '';
    return;
  }

  const hash = appState.hashes[appState.selectedRow] || "";
  const difficultyConfig = RoundSetter.DIFFICULTIES[appState.difficulty];
  
  const hexChars = hash.slice(0, difficultyConfig.columnCount * RoundSetter.DECIMALS_PER_TILE).split('');
  
  const hexGroups = [];
  for (let i = 0; i < hexChars.length; i += RoundSetter.DECIMALS_PER_TILE) {
    hexGroups.push(hexChars.slice(i, i + RoundSetter.DECIMALS_PER_TILE));
  }

  const groupsWithRates = hexGroups.map((group, index) => {
    const decimals = group.map(c => parseInt(c, 16));
    
    const rate = decimals.reduce((acc, decimal, decimalIndex) => {
      let k;
      switch (decimalIndex) {
        case 0: k = RoundSetter.K_POW_1; break;
        case 1: k = RoundSetter.K_POW_2; break;
        case 2: k = RoundSetter.K_POW_3; break;
        case 3: k = RoundSetter.K_POW_4; break;
        default: k = 0;
      }
      return acc + decimal / k;
    }, 0);

    return {
      index,
      hex: group.join(''),
      decimals,
      rate
    };
  });

  const sortedGroups = [...groupsWithRates].sort((a, b) => a.rate - b.rate);
  const positions = sortedGroups.map(g => g.index);

  const baseRow = RoundSetter.createRow(difficultyConfig.treasuresCount, difficultyConfig.columnCount);
  
  let explanationHTML = `
    <div class="calculation-explanation">
      <h3>Explanation for Row ${appState.selectedRow + 1}</h3>
      
      <div class="row-explanation">
        <div class="explanation-step">
          <h4>Step 1: Get HMAC-SHA256 for the row</h4>
          <p>We use the server seed, client seed, and row number to create a hash:</p>
          <pre>hmacSha256("${appState.clientSeed}:${appState.nonce}:${appState.selectedRow}", "${appState.serverSeed}") = ${hash}</pre>
        </div>
        
        <div class="explanation-step">
          <h4>Step 2: Get HMAC-SHA256 first ${difficultyConfig.columnCount} groups of ${RoundSetter.DECIMALS_PER_TILE} characters</h4>
          ${hexGroups.map((group, idx) => `
            <div class="hex-group">
              <strong>Group ${idx}:</strong> ${group.join('')} (hex values: <b>${group.map(c => parseInt(c, 16)).join(', ')}</b>)
            </div>
          `).join('')}
        </div>
        
        <div class="explanation-step">
          <h4>Step 3: Calculate rate for each group</h4>
          ${groupsWithRates.map((group, idx) => `
            <div class="rate-calculation">
              <strong>Group ${idx}:</strong> rate = 
              ${group.decimals.map((decimal, decimalIdx) => {
                let k;
                switch (decimalIdx) {
                  case 0: k = RoundSetter.K_POW_1; break;
                  case 1: k = RoundSetter.K_POW_2; break;
                  case 2: k = RoundSetter.K_POW_3; break;
                  case 3: k = RoundSetter.K_POW_4; break;
                  default: k = 0;
                }
                return ` ${decimal} / ${k}${decimalIdx < group.decimals.length - 1 ? ' +' : ''}`;
              }).join('')} = <b>${group.rate.toFixed(12)}</b>
            </div>
          `).join('')}
        </div>
        
        <div class="explanation-step">
          <h4>Step 4: Sort by rate and determine order</h4>
          <p>After sorting by rate, the placement order is:</p> 
          <p>${sortedGroups.map((group) => group.rate.toFixed(12)).join(', ')}</p>
          <strong>${positions.join(', ')}</strong>
        </div>
        
        <div class="explanation-step">
          <h4>Step 5: Determine what is in each position</h4>
          <p>
            We take a base row order (which is always the same for the same difficulty): 
            <div class="base-row-container">
              ${baseRow.map((item, idx) => `
                <span class="base-row-item">
                  <span class="item-index">${idx}</span>
                  <span class="item-value">${item}</span>
                </span>
              `).join('')}
            </div>
          </p>
          <p>
            Result (placing base row items in order ${positions.join(', ')}): 
            <div class="base-row-container">
              ${positions.map((pos, idx) => `
                <span class="base-row-item">
                  <span class="item-index">${pos}</span>
                  <span class="item-value">${baseRow[pos]}</span>
                </span>
              `).join('')}
            </div>
          </p>
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

function handleDifficultyChange(event) {
  appState.difficulty = event.target.value;
  updateResults();
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const difficultySelect = document.getElementById('difficulty-select');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);
  difficultySelect.addEventListener('change', handleDifficultyChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp); 