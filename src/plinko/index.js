const PLINKO_PATH_SLOT = {
  L: "L",
  R: "R",
};

class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

const CHARS_FOR_INT = 2;
const DECIMALS_USED = 4;
const K_POW = 256;

class PathCalculator {
  static SHA512_HASH_LENGTH = 128;

  static CHARS_FOR_INT = CHARS_FOR_INT;
  static DECIMALS_USED = DECIMALS_USED;
  static CHARS_PER_ROW = CHARS_FOR_INT * DECIMALS_USED;

  static DIRECTION_THRESHOLD = 0.5;

  static K_POW_1 = K_POW;
  static K_POW_2 = Math.pow(K_POW, 2);
  static K_POW_3 = Math.pow(K_POW, 3);
  static K_POW_4 = Math.pow(K_POW, 4);

  static getData(serverSeed, nonce, clientSeed) {
    const sha512Hmac = ShaUtils.hmacSha512(`${clientSeed}:${nonce}`, serverSeed).toString();

    const byteArray = this._hashToByteArray(sha512Hmac);

    const flatDecimalArray = this._byteArrayToDecimalArray(byteArray).flat();

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha512Hmac,
      bytesTable: byteArray
        .map(
          (it, index) => ({ hex: it, decimal: flatDecimalArray[index] })
        ),
      pathTable: this._getPathFromHash(sha512Hmac),
    };
  }

  static _hashToByteArray(hash) {
    return hash
      .match(/.{1,2}/g);
  }

  static _byteArrayToDecimalArray(byteArray) {
    return byteArray
      .map(byte => parseInt(byte, 16))
      .reduce(
      (result, current, index) => {
        if (index % this.DECIMALS_USED === 0) {
          result.push([])
        }

        result[result.length - 1].push(current);

        return result;
      }, 
      [],
    )
  }
  
  static _decimalArrayToValueNumbersArrau(decimalArray) {
    return decimalArray
      .map(
      	(group) => {
        	return group.reduce(
            (acc, decimal, index) => {
              const k = [this.K_POW_1, this.K_POW_2, this.K_POW_3, this.K_POW_4][index];
              
              return acc + decimal / k;
            },
            0,
          );
        }
    )
  }

  static _getPathFromHash(hash) {
    if (hash.length !== this.SHA512_HASH_LENGTH) {
      return [];
    }

    const byteArray = this._hashToByteArray(hash);
    const decimalArray = this._byteArrayToDecimalArray(byteArray);
    const valueNumbersArray = this._decimalArrayToValueNumbersArrau(decimalArray);

    return valueNumbersArray
      .map(
        (sum) => {
					return {
          	value: sum,
            direction: sum < PathCalculator.DIRECTION_THRESHOLD ? PLINKO_PATH_SLOT.L : PLINKO_PATH_SLOT.R,
          }
        }
      );
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  sha512Hmac: '',
  bytesTableData: [],
  pathTableData: []
};

function createMathExample(group) {
  const firstResult = group[0] / 256;
  const secondResult = group[1] / Math.pow(256, 2);
  const thirdResult = group[2] / Math.pow(256, 3);
  const fourthResult = group[3] / Math.pow(256, 4);
  
  const sum = firstResult + secondResult + thirdResult + fourthResult;

  return `
    (${group[0]}/256^1) + (${group[1]}/256^2) + (${group[2]}/256^3) + (${group[3]}/256^4)
= ${firstResult} + ${secondResult} + ${thirdResult} + ${fourthResult} = ${sum}
  `;
}

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha512Hmac = '';
    appState.bytesTableData = [];
    appState.pathTableData = [];
    renderResults();
    return;
  }

  try {
    const data = PathCalculator.getData(appState.serverSeed, appState.nonce, appState.clientSeed);

    appState.sha256 = data.sha256;
    appState.sha512Hmac = data.sha512Hmac;
    appState.bytesTableData = data.bytesTable;
    appState.pathTableData = data.pathTable;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha512Hmac = '';
    appState.bytesTableData = [];
    appState.pathTableData = [];
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha512HmacInput = document.getElementById('sha512-hmac-input');
  
  sha256Input.value = appState.sha256;
  sha512HmacInput.value = appState.sha512Hmac;

  renderTables();
}

function renderTables() {
  const tablesContainer = document.getElementById('tables-container');
  
  if (appState.bytesTableData.length === 0) {
    tablesContainer.innerHTML = '';
    return;
  }

  const firstGroup = appState.bytesTableData
    .slice(0, 4)
    .map((it) => it.decimal);

  const tablesHTML = `
    <div class="section">
      <div class="subtitle">
        Transform each group of four bytes into a numeric value.
      </div>
      
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>№</th>
              ${appState.bytesTableData.map((it, index) => `<td>${index}</td>`).join('')}
            </tr>
          </thead>

          <tbody>
            <tr>
              <th>Hex</th>
              ${appState.bytesTableData.map((it) => `<td>${it.hex}</td>`).join('')}
            </tr>

            <tr>
              <th>Base 10</th>
              ${appState.bytesTableData.map((it) => `<td>${it.decimal}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
      
      <div class="text">
        Every group of 4 bytes is converted into a number within the range (0, 1). For simplicity, only the initial calculation is shown (group is
        <span style="font-weight: 600">${firstGroup.join(", ")}</span>)
      </div>

      <div class="math">
        ${createMathExample(firstGroup)}
      </div>
    </div>
    
    <div class="divider"></div>
    
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Direction</th>
          </tr>
        </thead>

        <tbody>
          ${appState.pathTableData.map((it) => `
            <tr>
              <td style="text-align: initial">${it.value}</td>
              <td>${it.direction}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  tablesContainer.innerHTML = tablesHTML;
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