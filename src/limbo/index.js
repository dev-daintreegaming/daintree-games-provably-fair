class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

const N_BITS = 52;

class RoundSettler {
  static N_BITS = N_BITS;

  static DIVIDER = 2 ** N_BITS;

  static compute(hash) {
    const margin = 100 - getRTP();
    const range = this.sliceHexString(hash, 0, this.N_BITS / 4);
    const r = parseInt(range, 16);

    let x = parseFloat((r / this.DIVIDER).toPrecision(9));

    x = (100.0 - margin) / (1 - x);

    const result = Math.floor(x);

    return Math.max(1.0, result / 100);
  }
  
  static sliceHexString(hexString, start, end) {
    return hexString.slice(start, end);
  }
    
  static getData(serverSeed, nonce, clientSeed) {
    const sha256Hmac = ShaUtils.hmacSha256(`${clientSeed}:${nonce}`, serverSeed).toString();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha256Hmac,
      multiplier: this.compute(sha256Hmac),
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  sha256Hmac: '',
  multiplier: null
};

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.multiplier = null;
    renderResults();
    return;
  }

  try {
    const data = RoundSettler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);

    appState.sha256 = data.sha256;
    appState.sha256Hmac = data.sha256Hmac;
    appState.multiplier = data.multiplier;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.multiplier = null;
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha256HmacInput = document.getElementById('sha256-hmac-input');
  const multiplierDisplay = document.getElementById('multiplier-display');
  
  sha256Input.value = appState.sha256;
  sha256HmacInput.value = appState.sha256Hmac;
  
  if (appState.multiplier !== null) {
    multiplierDisplay.textContent = `${appState.multiplier}x`;
  } else {
    multiplierDisplay.textContent = '';
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