class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

class RoundSetter {
  static SHA512_HASH_LENGTH = 128;
  static HEX_CHARS_PER_TILE = 4;

  static DIFFICULTIES = {
    EASY: {
      maxSteps: 19,
      outcomesCount: 7
    },
    MEDIUM: {
      maxSteps: 17,
      outcomesCount: 3
    },
    HARD: {
      maxSteps: 11,
      outcomesCount: 2
    }
  };

  static getData(serverSeed, nonce, clientSeed, difficulty = 'EASY') {
    const message = `${clientSeed}:${nonce}`;
    const hash = ShaUtils.hmacSha512(message, serverSeed).toString();
    const path = this.getPath(hash, difficulty);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      hash,
      path
    };
  }

  static getPath(hash, difficulty) {
    const difficultyConfig = this.DIFFICULTIES[difficulty];
    const requiredChars = difficultyConfig.maxSteps * this.HEX_CHARS_PER_TILE;

    if (hash.length < requiredChars) {
      throw new Error(`Hash is too short. Required: ${requiredChars}, actual: ${hash.length}`);
    }

    const hashPart = hash.slice(0, requiredChars);
    const chunks = [];

    for (let i = 0; i < hashPart.length; i += this.HEX_CHARS_PER_TILE) {
      chunks.push(hashPart.slice(i, i + this.HEX_CHARS_PER_TILE));
    }

    return chunks.map(hexChunk => {
      const value = parseInt(hexChunk, 16);
      const position = value % difficultyConfig.outcomesCount;
      return position === 0 ? 'DANGER' : 'SAFE';
    });
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  difficulty: 'EASY',
  sha256: '',
  hash: '',
  path: [],
  showExplanation: true
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.hash = '';
    appState.path = [];
    renderResults();
    return;
  }

  try {
    const data = RoundSetter.getData(appState.serverSeed, appState.nonce, appState.clientSeed, appState.difficulty);
    appState.sha256 = data.sha256;
    appState.hash = data.hash;
    appState.path = data.path;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.hash = '';
    appState.path = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  sha256Input.value = appState.sha256;

  renderPath();
  renderExplanation();
}

function renderPath() {
  const pathContainer = document.getElementById('path-container');

  if (!appState.path.length) {
    pathContainer.innerHTML = '';
    return;
  }

  let pathHTML = `
    <div class="path-display">
      <div class="path-label">Path (${appState.path.length} steps):</div>
      <div class="path-container">
        <div class="path-steps">
          ${appState.path.map((step, index) => `
            <div class="path-step ${step.toLowerCase()}">
              <span class="step-number">${index + 1}</span>
              <span class="step-value">${step}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  pathContainer.innerHTML = pathHTML;
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');

  if (!appState.path.length || !appState.hash) {
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

  const hash = appState.hash;
  const difficultyConfig = RoundSetter.DIFFICULTIES[appState.difficulty];
  const requiredChars = difficultyConfig.maxSteps * RoundSetter.HEX_CHARS_PER_TILE;
  const hashPart = hash.slice(0, requiredChars);

  const hexGroups = [];
  for (let i = 0; i < hashPart.length; i += RoundSetter.HEX_CHARS_PER_TILE) {
    hexGroups.push(hashPart.slice(i, i + RoundSetter.HEX_CHARS_PER_TILE));
  }

  const stepsWithCalculations = hexGroups.map((hexChunk, index) => {
    const value = parseInt(hexChunk, 16);
    const position = value % difficultyConfig.outcomesCount;
    const result = position === 0 ? 'DANGER' : 'SAFE';

    return {
      index,
      hexChunk,
      value,
      position,
      result
    };
  });

  let explanationHTML = `
    <div class="calculation-explanation">
      <h3>Explanation</h3>
      
      <div class="row-explanation">
        <div class="explanation-step">
          <h4>Step 1: Calculate HMAC-SHA512</h4>
          <p>We use the server seed and client seed with nonce to create a hash:</p>
          <pre>hmacSha512("${appState.clientSeed}:${appState.nonce}", "${appState.serverSeed}") = ${hash}</pre>
        </div>
        
        <div class="explanation-step">
          <h4>Step 2: Take first ${requiredChars} hex characters</h4>
          <p>We need ${difficultyConfig.maxSteps} steps, each requiring ${RoundSetter.HEX_CHARS_PER_TILE} hex characters:</p>
          <pre>${hashPart}</pre>
        </div>
        
        <div class="explanation-step">
          <h4>Step 3: Split into groups of ${RoundSetter.HEX_CHARS_PER_TILE} characters</h4>
          ${hexGroups.map((group, idx) => `
            <div class="hex-group">
              <strong>Group ${idx}:</strong> ${group}
            </div>
          `).join('')}
        </div>
        
        <div class="explanation-step">
          <h4>Step 4: Calculate each step</h4>
          <p>For each group, convert to decimal and calculate: <strong>position = value % ${difficultyConfig.outcomesCount}</strong></p>
          <p>If position == 0, result is <strong>DANGER</strong>, otherwise <strong>SAFE</strong></p>
          ${stepsWithCalculations.map((step, idx) => `
            <div class="rate-calculation">
              <strong>Step ${idx + 1}:</strong>
              <div>Hex: <b>${step.hexChunk}</b></div>
              <div>Decimal value: <b>${step.value}</b></div>
              <div>Position: <b>${step.value} % ${difficultyConfig.outcomesCount} = ${step.position}</b></div>
              <div>Result: <b>${step.result}</b></div>
            </div>
          `).join('')}
        </div>
        
        <div class="explanation-step">
          <h4>Step 5: Final path</h4>
          <p>The complete path is:</p>
          <div class="base-row-container">
            ${appState.path.map((step, idx) => `
              <span class="base-row-item">
                <span class="item-index">${idx + 1}</span>
                <span class="item-value ${step.toLowerCase()}">${step}</span>
              </span>
            `).join('')}
          </div>
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

function showExplanation() {
  appState.showExplanation = true;
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
