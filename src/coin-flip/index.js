class ShaUtils {
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

class RoundSettler {
  static MAX_FLIPS_COUNT = 10;
  static HEX_CHARS_PER_BYTE = 2;

  static getOutcomes(hash) {
    // Take first MAX_FLIPS_COUNT * 2 hex characters
    const hashPart = hash.slice(0, this.MAX_FLIPS_COUNT * this.HEX_CHARS_PER_BYTE);
    
    // Split into groups of 2 characters
    const groups = [];
    for (let i = 0; i < hashPart.length; i += this.HEX_CHARS_PER_BYTE) {
      groups.push(hashPart.slice(i, i + this.HEX_CHARS_PER_BYTE));
    }
    
    return groups.map(group => {
      const bit = parseInt(group, 16) % 2;
      return this.resolveFlipSide(bit);
    });
  }

  static resolveFlipSide(bit) {
    return bit === 0 ? 'HEADS' : 'TAILS';
  }

  static getData(serverSeed, nonce, clientSeed) {
    const message = `${clientSeed}:${nonce}`;
    const hash = ShaUtils.hmacSha256(message, serverSeed).toString();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      hash,
      outcomes: this.getOutcomes(hash)
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  outcomes: [],
  hash: ''
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.hash = '';
    appState.outcomes = [];
    renderResults();
    return;
  }

  try {
    const data = RoundSettler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);
    appState.sha256 = data.sha256;
    appState.hash = data.hash;
    appState.outcomes = data.outcomes;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.hash = '';
    appState.outcomes = [];
  }

  renderResults();
}

function createOutcomeRow(index, outcome, hexGroup) {
  const outcomeWrapper = document.createElement('div');
  outcomeWrapper.className = 'outcome-wrapper';
  
  const indexDiv = document.createElement('div');
  indexDiv.className = 'flip-index'
  indexDiv.textContent = `#${index + 1}`;
  
  const outcomeDiv = document.createElement('div');
  outcomeDiv.className = `outcome ${outcome.toLowerCase()}`;
  outcomeDiv.textContent = outcome;
  
  const hexGroupDiv = document.createElement('div');
  hexGroupDiv.className = 'hex-group-div';
  hexGroupDiv.textContent = hexGroup;
  
  outcomeWrapper.appendChild(indexDiv);
  outcomeWrapper.appendChild(outcomeDiv);
  outcomeWrapper.appendChild(hexGroupDiv);
  
  return outcomeWrapper;
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  if (sha256Input) {
    sha256Input.value = appState.sha256;
  }

  const resultsContainer = document.getElementById('results-container');
  
  if (appState.outcomes.length === 0) {
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
    <h4>Result for each flip is calculated following these steps:</h4>
    <div><b>Step 1:</b> Calculate <strong>HMAC-SHA256</strong> of message "clientSeed:nonce" with key serverSeed</div>
    <div><b>Step 2:</b> Take first <strong>${RoundSettler.MAX_FLIPS_COUNT * RoundSettler.HEX_CHARS_PER_BYTE} hex characters</strong> from the hash</div>
    <div><b>Step 3:</b> Split into groups of <strong>${RoundSettler.HEX_CHARS_PER_BYTE} characters</strong> (each group represents one flip)</div>
    <div><b>Step 4:</b> Convert each group from hex to decimal number and apply <strong>% 2</strong></div>
    <div><b>Step 5:</b> If result is <strong>0 = HEADS</strong>, if <strong>1 = TAILS</strong></div>
  `;
  
  helperText.appendChild(step);
  
  resultsWrapper.appendChild(helperText);
  
  const hashStart = appState.hash.slice(0, RoundSettler.MAX_FLIPS_COUNT * RoundSettler.HEX_CHARS_PER_BYTE);
  const hexGroups = [];
  for (let i = 0; i < hashStart.length; i += RoundSettler.HEX_CHARS_PER_BYTE) {
    hexGroups.push(hashStart.slice(i, i + RoundSettler.HEX_CHARS_PER_BYTE));
  }
  
  appState.outcomes.forEach((outcome, index) => {
    const outcomeRow = createOutcomeRow(index, outcome, hexGroups[index]);
    resultsWrapper.appendChild(outcomeRow);
  });
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