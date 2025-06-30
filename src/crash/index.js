const normalizeMultiplier = (multiplier) =>
  `${multiplier.toFixed(2)}x`;

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

class RoundSettler {
  static SALT = "000000000000000000001f464e9a239f20bc3dd901bcb7a8c1de8ba9967871bc";
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
  static hexEncoder = CryptoJS.enc.Hex;

  static setSalt(salt) {
    this.SALT = salt;
  }

  /**
   * 52 - Number of most significant bits to use.
   */
  static N_BITS = 52;

  static DIVIDER = Math.pow(2, 52);

  static getResult(seed) {
    const margin = 100 - getRTP();
    const hmac = RoundSettler.hmacSha256(seed, RoundSettler.SALT);
    const salted = hmac.toString(RoundSettler.hexEncoder);

    const range = RoundSettler.sliceHexString(salted, 0, RoundSettler.N_BITS / 4);
    const r = parseInt(range, 16);

    let x = parseFloat((r / RoundSettler.DIVIDER).toPrecision(9));

    x = (100 - margin) / (1 - x);

    const result = Math.floor(x);

    return Math.max(1.0, result / 100);
  }

  static sliceHexString(hexString, start, end) {
    return hexString.slice(start, end);
  }

  static getPreviousRoundHash(hash) {
    return RoundSettler.sha256(RoundSettler.hexEncoder.parse(hash)).toString();
  }
}

let appState = {
  hash: '',
  limit: 50,
  results: []
};

function createOutcomeRow(hash, multiplier) {
  const outcomeWrapper = document.createElement('div');
  outcomeWrapper.className = 'outcome-wrapper';
  
  const hashDiv = document.createElement('div');
  hashDiv.className = 'hash-wrapper'
  hashDiv.textContent = hash;
  
  const multiplierDiv = document.createElement('div');
  multiplierDiv.textContent = normalizeMultiplier(multiplier);
  
  outcomeWrapper.appendChild(hashDiv);
  outcomeWrapper.appendChild(multiplierDiv);
  
  return outcomeWrapper;
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
    const outcomeRow = createOutcomeRow(result.hash, result.multiplier);
    resultsWrapper.appendChild(outcomeRow);
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
    results.push({
      multiplier: RoundSettler.getResult(closuredHash),
      hash: closuredHash,
    });
    
    closuredHash = RoundSettler.getPreviousRoundHash(closuredHash);
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
