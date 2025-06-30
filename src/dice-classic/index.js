class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

class RoundSettler {
  static compute(hash) {
    const num = parseInt(hash.substring(0, 13), 16);

    return (num % 10001) / 100.0;
  }
    
  static getData(serverSeed, nonce, clientSeed) {
    const sha256Hmac = ShaUtils.hmacSha256(`${clientSeed}:${nonce}`, serverSeed).toString();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha256Hmac,
      rollValue: this.compute(sha256Hmac),
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  sha256Hmac: '',
  rollValue: null
};

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.rollValue = null;
    renderResults();
    return;
  }

  try {
    const data = RoundSettler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);

    appState.sha256 = data.sha256;
    appState.sha256Hmac = data.sha256Hmac;
    appState.rollValue = data.rollValue;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.rollValue = null;
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha256HmacInput = document.getElementById('sha256-hmac-input');
  const rollValueDisplay = document.getElementById('roll-value-display');
  
  sha256Input.value = appState.sha256;
  sha256HmacInput.value = appState.sha256Hmac;
  
  if (appState.rollValue !== null) {
    rollValueDisplay.textContent = appState.rollValue;
  } else {
    rollValueDisplay.textContent = '';
  }
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