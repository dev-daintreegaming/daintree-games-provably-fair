const ROULETTE_OUTCOME = {
  GREEN: "GREEN",
  RED: "RED",
  BLACK: "BLACK",
};

class RoundSettler {
  static SALT = "00000000000000000000f05824d806e3e3f35f9448a1a7e30134bb8acb3a18a2";
  static HMACSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
  static hexEncoder = CryptoJS.enc.Hex;

  static getResult(hash) {
    const salted = this.saltHash(hash);

    const result = this.getIntResultFromHash(salted);

    if (result === 0) {
      return {
        outcome: ROULETTE_OUTCOME.GREEN,
        number: result,
        hash,
      };
    }

    if (result >= 1 && result <= 7) {
      return {
        outcome: ROULETTE_OUTCOME.RED,
        number: result,
        hash,
      };
    }

    if (result >= 8 && result <= 15) {
      return {
        outcome: ROULETTE_OUTCOME.BLACK,
        number: result,
        hash,
      };
    }

    throw new Error(`[RoundSettler]: Invalid result ${result}`);
  }

  static getPreviousHash(hash) {
    return RoundSettler.sha256(RoundSettler.hexEncoder.parse(hash)).toString();
  }

  static getIntResultFromHash(hash) {
    const num = parseInt(hash.substring(0, 13), 16);

    return num % 15;
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

function getOutcomeClassName(outcome) {
  if (outcome === ROULETTE_OUTCOME.GREEN) {
    return "outcome-green";
  }
  
  if (outcome === ROULETTE_OUTCOME.RED) {
    return "outcome-red";
  }
  
  if (outcome === ROULETTE_OUTCOME.BLACK) {
    return "outcome-black";
  }
  
  return "";
}

function createOutcomeRow(hash, outcome, number) {
  const outcomeWrapper = document.createElement('div');
  outcomeWrapper.className = 'outcome-wrapper';
  
  const hashDiv = document.createElement('div');
  hashDiv.className = 'hash-wrapper'
  hashDiv.textContent = hash;
  
  const numberDiv = document.createElement('div');
  numberDiv.className = `outcome ${getOutcomeClassName(outcome)}`;
  numberDiv.textContent = number;
  
  outcomeWrapper.appendChild(hashDiv);
  outcomeWrapper.appendChild(numberDiv);
  
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
    const outcomeRow = createOutcomeRow(result.hash, result.outcome, result.number);
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