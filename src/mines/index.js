class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

class BoardShuffler {
  static SHA512_HASH_LENGTH = 128;
  
  static BOARD_SIZE = 25;
  static DECIMALS_USED = 4;

  static K_POW_1 = 16;
  static K_POW_2 = 16 * 16;
  static K_POW_3 = 16 * 16 * 16;
  static K_POW_4 = 16 * 16 * 16 * 16;

  static getData(serverSeed, nonce, clientSeed) {
    const sha512Hmac = ShaUtils.hmacSha512(`${clientSeed}:${nonce}`, serverSeed).toString();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha512Hmac,
      board: this.getBoardFromHash(sha512Hmac),
    };
  }
  
  static getBoardFromHash(hash) {
    if (hash.length !== this.SHA512_HASH_LENGTH) {
      throw new Error(`Invalid hash size: ${hash.length}. It should be equal to ${this.SHA512_HASH_LENGTH}`);
    }

    return Array.from(hash.slice(0, this.BOARD_SIZE * this.DECIMALS_USED))
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

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  sha512: '',
  board: []
};

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha512 = '';
    appState.board = [];
    renderResults();
    return;
  }

  try {
    const data = BoardShuffler.getData(appState.serverSeed, appState.nonce, appState.clientSeed);
    appState.sha256 = data.sha256;
    appState.sha512 = data.sha512Hmac;
    appState.board = data.board;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha512 = '';
    appState.board = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha512Input = document.getElementById('sha512-hmac-input');
  const boardDisplay = document.getElementById('board-display');

  sha256Input.value = appState.sha256;
  sha512Input.value = appState.sha512;
  boardDisplay.textContent = `[ ${appState.board.join(", ")} ]`;
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