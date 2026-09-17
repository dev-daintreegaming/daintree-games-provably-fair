class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

// Frozen outcome catalogue, mirrors TwistSegmentTable.
class TwistSegmentTable {
  static OUTCOME_WATER_GEM = 0;
  static OUTCOME_EARTH_GEM = 1;
  static OUTCOME_FIRE_GEM = 2;
  static OUTCOME_AIR = 3;
  static OUTCOME_DEATH = 4;

  static OUTCOMES = [
    { index: 0, key: 'WATER_GEM', label: 'Water gem' },
    { index: 1, key: 'EARTH_GEM', label: 'Earth gem' },
    { index: 2, key: 'FIRE_GEM', label: 'Fire gem' },
    { index: 3, key: 'AIR', label: 'Air' },
    { index: 4, key: 'DEATH', label: 'Death' },
  ];

  // Outcome weights per supported RTP, index-aligned with the outcomes above, summing to 10000.
  static WEIGHTS_BY_RTP = {
    95: [1929, 1286, 845, 4237, 1703],
    96: [1949, 1299, 854, 4195, 1703],
    97: [1969, 1313, 863, 4152, 1703],
    98: [1990, 1326, 872, 4109, 1703],
    99: [2010, 1340, 881, 4066, 1703],
  };

  static weights(rtp) {
    const weights = this.WEIGHTS_BY_RTP[rtp];
    if (!weights) {
      throw new Error(`Twist outcome weights not found for rtp: ${rtp}`);
    }

    return weights.slice();
  }
}

// Frozen bonus-wheel sector table, mirrors TwistBonusWheelTable.
class TwistBonusWheelTable {
  static SECTOR_MULTIPLIERS = [100.0, 200.0, 300.0, 400.0, 500.0];

  // The sectors are equally weighted at every RTP — the RTP adjustment lives in the fire gem weight.
  static resolveSectorIndex(hash) {
    const rate = TwistSegmentResolver.calculateRate(hash);
    const index = Math.floor(rate * this.SECTOR_MULTIPLIERS.length);

    return Math.min(index, this.SECTOR_MULTIPLIERS.length - 1);
  }
}

// Hash-to-segment resolver, mirrors TwistSegmentResolver.
class TwistSegmentResolver {
  static SHA512_HASH_LENGTH = 128;
  static RATE_HEX_DIGITS = 8;

  // rate = sum(d_i / 16^(i+1)) over the first 8 hex characters, a number in [0, 1).
  static calculateRate(hash) {
    if (hash.length !== this.SHA512_HASH_LENGTH) {
      throw new Error(`Invalid hash size: ${hash.length}. It should be equal to ${this.SHA512_HASH_LENGTH}`);
    }

    let rate = 0;
    let denominator = 16;

    for (let i = 0; i < this.RATE_HEX_DIGITS; i++) {
      rate += parseInt(hash.charAt(i), 16) / denominator;
      denominator *= 16;
    }

    return rate;
  }

  // Walks the frozen outcome order accumulating weights and returns the first index the target falls in.
  static resolveSegmentIndex(hash, rtp) {
    const weights = TwistSegmentTable.weights(rtp);
    const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
    const target = this.calculateRate(hash) * totalWeight;

    let cumulative = 0;
    for (let index = 0; index < weights.length; index++) {
      cumulative += weights[index];
      if (target < cumulative) {
        return index;
      }
    }

    return weights.length - 1;
  }
}

class RoundResultResolver {
  // A spin resolves from its own nonce; the bonus wheel rides on the same nonce under a distinct
  // label, so it never consumes a nonce of its own.
  static roundMessage(clientSeed, nonce) {
    return `${clientSeed}:${nonce}`;
  }

  static bonusWheelMessage(clientSeed, nonce) {
    return `${clientSeed}:${nonce}:bonus-wheel`;
  }

  static getData(serverSeed, nonce, clientSeed, rtp) {
    const roundHash = ShaUtils.hmacSha512(this.roundMessage(clientSeed, nonce), serverSeed).toString();
    const bonusWheelHash = ShaUtils.hmacSha512(this.bonusWheelMessage(clientSeed, nonce), serverSeed).toString();

    const weights = TwistSegmentTable.weights(rtp);
    const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
    const rate = TwistSegmentResolver.calculateRate(roundHash);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      roundHash,
      bonusWheelHash,
      weights,
      totalWeight,
      rate,
      target: rate * totalWeight,
      outcomeIndex: TwistSegmentResolver.resolveSegmentIndex(roundHash, rtp),
      bonusWheelRate: TwistSegmentResolver.calculateRate(bonusWheelHash),
      sectorIndex: TwistBonusWheelTable.resolveSectorIndex(bonusWheelHash),
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  sha256: '',
  data: null,
  error: '',
  showExplanation: true,
};

function cumulativeRanges(weights) {
  const ranges = [];
  let cumulative = 0;

  weights.forEach((weight) => {
    ranges.push({ from: cumulative, to: cumulative + weight });
    cumulative += weight;
  });

  return ranges;
}

function updateResults() {
  if (!appState.serverSeed || !appState.nonce || !appState.clientSeed) {
    appState.sha256 = '';
    appState.data = null;
    appState.error = '';
    renderResults();
    return;
  }

  try {
    const data = RoundResultResolver.getData(
      appState.serverSeed,
      appState.nonce,
      appState.clientSeed,
      getRTP(),
    );

    appState.sha256 = data.sha256;
    appState.data = data;
    appState.error = '';
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.data = null;
    appState.error = error.message;
  }

  renderResults();
}

function renderResults() {
  document.getElementById('sha256-input').value = appState.sha256;
  document.getElementById('round-hash-input').value = appState.data ? appState.data.roundHash : '';
  document.getElementById('bonus-wheel-hash-input').value = appState.data ? appState.data.bonusWheelHash : '';

  renderOutcome();
  renderExplanation();
}

function renderOutcome() {
  const outcomeContainer = document.getElementById('outcome-container');

  if (!appState.data) {
    outcomeContainer.innerHTML = appState.error
      ? `<div class="error">${appState.error}</div>`
      : '';
    return;
  }

  const { weights, outcomeIndex, sectorIndex } = appState.data;
  const ranges = cumulativeRanges(weights);
  const outcome = TwistSegmentTable.OUTCOMES[outcomeIndex];

  const outcomesHTML = TwistSegmentTable.OUTCOMES
    .map((item) => `
      <div class="outcome-card ${item.key.toLowerCase()} ${item.index === outcomeIndex ? 'resolved' : ''}">
        <div class="outcome-label">${item.label}</div>
        <div class="outcome-weight">weight ${weights[item.index]}</div>
        <div class="outcome-range">[${ranges[item.index].from}, ${ranges[item.index].to})</div>
      </div>
    `)
    .join('');

  const sectorsHTML = TwistBonusWheelTable.SECTOR_MULTIPLIERS
    .map((multiplier, index) => `
      <div class="sector ${index === sectorIndex ? 'drawn' : ''}">
        <span class="sector-index">${index}</span>
        <span class="sector-value">${multiplier}x</span>
      </div>
    `)
    .join('');

  outcomeContainer.innerHTML = `
    <div class="result-block">
      <div class="result-line">
        <span class="text">Symbol: </span>
        <span class="subtitle">${outcome.label} (index ${outcomeIndex})</span>
      </div>
    </div>

    <div class="outcome-cards">${outcomesHTML}</div>

    <div class="text">
      Bonus wheel for this nonce — drawn only when a spin moves the fire marker onto the top of its ring:
    </div>
    <div class="sectors">${sectorsHTML}</div>
    <div class="subtitle">Sector ${sectorIndex} — ${TwistBonusWheelTable.SECTOR_MULTIPLIERS[sectorIndex]}x</div>
  `;
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');

  if (!appState.data) {
    explanationContainer.innerHTML = '';
    return;
  }

  if (!appState.showExplanation) {
    explanationContainer.innerHTML = `
      <div class="toggle-explanation">
        <button class="button" onclick="showExplanation()">
          Show Explanation
        </button>
      </div>
    `;
    return;
  }

  const {
    roundHash,
    bonusWheelHash,
    weights,
    totalWeight,
    rate,
    target,
    outcomeIndex,
    bonusWheelRate,
    sectorIndex,
  } = appState.data;

  const rateHex = roundHash.slice(0, TwistSegmentResolver.RATE_HEX_DIGITS);
  const rateTermsHTML = Array.from(rateHex)
    .map((char, index) => `${parseInt(char, 16)} / 16<sup>${index + 1}</sup>`)
    .join(' + ');

  const ranges = cumulativeRanges(weights);
  const walkHTML = TwistSegmentTable.OUTCOMES
    .map((item) => {
      const range = ranges[item.index];
      const isResolved = item.index === outcomeIndex;
      const comparison = (() => {
        if (isResolved) {
          return `${target.toFixed(4)} &lt; ${range.to} → <strong>${item.label}</strong>`;
        }

        // The walk stops on the resolved outcome, so the rows below it are never compared.
        return item.index < outcomeIndex
          ? `${target.toFixed(4)} ≥ ${range.to} → keep walking`
          : 'not reached';
      })();

      return `
        <div class="walk-row ${isResolved ? 'resolved' : ''}">
          <span class="walk-label">${item.index}. ${item.label}</span>
          <span class="walk-weight">+${weights[item.index]}</span>
          <span class="walk-cumulative">cumulative ${range.to}</span>
          <span class="walk-comparison">${comparison}</span>
        </div>
      `;
    })
    .join('');

  const wheelRateHex = bonusWheelHash.slice(0, TwistSegmentResolver.RATE_HEX_DIGITS);
  const sectorCount = TwistBonusWheelTable.SECTOR_MULTIPLIERS.length;

  explanationContainer.innerHTML = `
    <div class="calculation-explanation">
      <h3>How this spin is resolved</h3>

      <div class="explanation-step">
        <h4>Step 1: Get the HMAC-SHA512 hashes of the round</h4>
        <p>The spin resolves from the client seed and the nonce:</p>
        <pre>hmacSha512("${RoundResultResolver.roundMessage(appState.clientSeed, appState.nonce)}", "${appState.serverSeed}") = ${roundHash}</pre>
        <p>
          The bonus wheel rides on the same nonce under a distinct label, so it stays verifiable on
          its own and never consumes a nonce of its own:
        </p>
        <pre>hmacSha512("${RoundResultResolver.bonusWheelMessage(appState.clientSeed, appState.nonce)}", "${appState.serverSeed}") = ${bonusWheelHash}</pre>
      </div>

      <div class="explanation-step">
        <h4>Step 2: Take the first ${TwistSegmentResolver.RATE_HEX_DIGITS} characters of the round hash and convert them to a rate</h4>
        <div class="horizontal-scroll">
          <strong class="rate-hex">${rateHex}</strong>
          <span class="paleText">${roundHash.slice(TwistSegmentResolver.RATE_HEX_DIGITS)}</span>
        </div>
        <p>rate = ${rateTermsHTML} = <b>${rate.toFixed(12)}</b></p>
      </div>

      <div class="explanation-step">
        <h4>Step 3: Scale the rate by the total symbol weight of the RTP ${getRTP()} table</h4>
        <p>Weights: ${weights.join(', ')} — total <b>${totalWeight}</b></p>
        <p>target = ${rate.toFixed(12)} × ${totalWeight} = <b>${target.toFixed(4)}</b></p>
      </div>

      <div class="explanation-step">
        <h4>Step 4: Walk the symbols accumulating weights and take the first one the target falls in</h4>
        <div class="walk">${walkHTML}</div>
        <p>Symbol: <strong>${TwistSegmentTable.OUTCOMES[outcomeIndex].label}</strong> (index ${outcomeIndex})</p>
      </div>

      <div class="explanation-step">
        <h4>Step 5: Resolve the bonus-wheel sector the same way</h4>
        <p>
          The five sectors are equally weighted at every RTP, so the wheel takes the rate of its own
          hash directly instead of walking a weight table:
        </p>
        <div class="horizontal-scroll">
          <strong class="rate-hex">${wheelRateHex}</strong>
          <span class="paleText">${bonusWheelHash.slice(TwistSegmentResolver.RATE_HEX_DIGITS)}</span>
        </div>
        <p>rate = <b>${bonusWheelRate.toFixed(12)}</b></p>
        <p>
          sector = min(floor(${bonusWheelRate.toFixed(12)} × ${sectorCount}), ${sectorCount - 1}) =
          <strong>${sectorIndex}</strong> → ${TwistBonusWheelTable.SECTOR_MULTIPLIERS[sectorIndex]}x
        </p>
      </div>

      <div class="toggle-explanation">
        <button class="button" onclick="hideExplanation()">
          Hide Explanation
        </button>
      </div>
    </div>
  `;
}

function showExplanation() {
  appState.showExplanation = true;
  renderExplanation();
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

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);

  document.getElementById('rtp-display').textContent = `${getRTP()}%`;

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
