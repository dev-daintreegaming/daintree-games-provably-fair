class RoundSettler {
  static SALT = "00000000000000000001cc9d0b10da67fb7d051df7cdb059cc9d0bf21a685599";
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
  static hexEncoder = CryptoJS.enc.Hex;

  static getResult(hash) {
    const hmac = this.hmacSha256(hash, this.SALT);

    const salted = hmac.toString(this.hexEncoder);

    return this.gameResultFromHash(salted);
  }

  static getPreviousHash(hash) {
    return this.sha256(this.hexEncoder.parse(hash)).toString();
  }

  static gameResultFromHash(hash) {
    const num = parseInt(hash.substring(0, 13), 16);

    return (num % 10001) / 100.0;
  }
}

let appState = {
  hash: '',
  limit: 50,
  results: []
};

function createOutcomeRow(hash, card) {
  const outcomeWrapper = document.createElement('div');
  outcomeWrapper.className = 'outcome-wrapper';
  
  const hashDiv = document.createElement('div');
  hashDiv.className = 'hash-wrapper'
  hashDiv.textContent = hash;
  
  const cardDiv = document.createElement('div');
  cardDiv.textContent = card;
  
  outcomeWrapper.appendChild(hashDiv);
  outcomeWrapper.appendChild(cardDiv);
  
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
    const outcomeRow = createOutcomeRow(result.hash, result.card);
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
      card: RoundSettler.getResult(closuredHash),
      hash: closuredHash,
    });
    
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