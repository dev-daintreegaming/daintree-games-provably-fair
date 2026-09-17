function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

class ShaUtils {
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
  static hexEncoder = CryptoJS.enc.Hex;
}

class BoostTable {
  static UNIT_BOOST = 100;

  static BOOSTS = [100, 200, 400, 800];
  static WEIGHTS = [528, 137, 28, 7];

  static WEIGHT_TOTAL = BoostTable.WEIGHTS.reduce((acc, weight) => acc + weight, 0);

  static CUMULATIVE_WEIGHTS = BoostTable.WEIGHTS.reduce(
    (acc, weight) => [...acc, (acc[acc.length - 1] || 0) + weight],
    [],
  );

  static WEIGHTED_TOTAL = BoostTable.WEIGHTS.reduce(
    (acc, weight, index) => acc + weight * BoostTable.BOOSTS[index],
    0,
  );

  static BOOST_MESSAGE_SUFFIX = ':climax:boost';

  static drawBoost(roundHash) {
    const draw = BoostTable.draw(roundHash);

    for (let entry = 0; entry < BoostTable.CUMULATIVE_WEIGHTS.length; entry++) {
      if (draw < BoostTable.CUMULATIVE_WEIGHTS[entry]) {
        return BoostTable.BOOSTS[entry];
      }
    }

    throw new Error(`Boost draw fell outside the weight table: ${draw}`);
  }

  static draw(roundHash) {
    return RoundSettler.uint52(roundHash + BoostTable.BOOST_MESSAGE_SUFFIX) % BoostTable.WEIGHT_TOTAL;
  }

}

class RoundSettler {
  static SALT = '000000000000000000001f464e9a239f20bc3dd901bcb7a8c1de8ba9967871bc';

  /**
   * 52 - Number of most significant bits to use.
   */
  static N_BITS = 52;

  static DIVIDER = Math.pow(2, 52);

  static HEX_CHARS_USED = RoundSettler.N_BITS / 4;

  static MAX_MULTIPLIER = 1000.01;
  static MIN_MULTIPLIER = 1.00;

  static MULTIPLIER_SCALE = 100;
  static PAYOUT_UNIT_HUNDREDTHS = 10000;

  static MIN_CASHOUT_HUNDREDTHS = 101;
  static COUNTER_STEP_HUNDREDTHS = 1;

  static MAX_MULTIPLIER_HUNDREDTHS = Math.round(RoundSettler.MAX_MULTIPLIER * RoundSettler.MULTIPLIER_SCALE);

  static CRASH_MESSAGE_SUFFIX = ':climax:crash';

  /**
   * The crash stage prices at the game RTP divided by the mean boost, never at the game RTP itself:
   * a round pays counter x boost, so only the product is the RTP the player is quoted.
   */
  static baseRtpPercent() {
    return (getRTP() * BoostTable.WEIGHT_TOTAL * BoostTable.UNIT_BOOST) / BoostTable.WEIGHTED_TOTAL;
  }

  static computeCrashMultiplier(roundHash) {
    const x = RoundSettler.uniform(roundHash + RoundSettler.CRASH_MESSAGE_SUFFIX);
    const multiplier = RoundSettler.baseRtpPercent() / (1 - x);
    const floored = Math.floor(multiplier);

    return Math.min(
      RoundSettler.MAX_MULTIPLIER,
      Math.max(RoundSettler.MIN_MULTIPLIER, floored / RoundSettler.MULTIPLIER_SCALE),
    );
  }

  static minCashoutMultiplier() {
    return RoundSettler.MIN_CASHOUT_HUNDREDTHS / RoundSettler.MULTIPLIER_SCALE;
  }

  static maxCashoutMultiplier() {
    return (
      (RoundSettler.MAX_MULTIPLIER_HUNDREDTHS - RoundSettler.COUNTER_STEP_HUNDREDTHS) /
      RoundSettler.MULTIPLIER_SCALE
    );
  }

  static payoutMultiplier(counterMultiplier, boost) {
    const counterHundredths = Math.round(counterMultiplier * RoundSettler.MULTIPLIER_SCALE);

    return (boost * counterHundredths) / RoundSettler.PAYOUT_UNIT_HUNDREDTHS;
  }

  /**
   * The highest counter a bet can still be banked at in this round, or null when the round dies before
   * the cash-out floor. A cash-out lands strictly before the crash, so the crash value itself is never
   * payable.
   */
  static topCashoutMultiplier(crashMultiplier) {
    const crashHundredths = Math.round(crashMultiplier * RoundSettler.MULTIPLIER_SCALE);
    const topHundredths = Math.min(
      crashHundredths - RoundSettler.COUNTER_STEP_HUNDREDTHS,
      RoundSettler.MAX_MULTIPLIER_HUNDREDTHS - RoundSettler.COUNTER_STEP_HUNDREDTHS,
    );

    if (topHundredths < RoundSettler.MIN_CASHOUT_HUNDREDTHS) {
      return null;
    }

    return topHundredths / RoundSettler.MULTIPLIER_SCALE;
  }

  static uniform(message) {
    return parseFloat((RoundSettler.uint52(message) / RoundSettler.DIVIDER).toPrecision(9));
  }

  static uint52(message) {
    return parseInt(RoundSettler.hmac(message).slice(0, RoundSettler.HEX_CHARS_USED), 16);
  }

  static hmac(message) {
    return ShaUtils.hmacSha256(message, RoundSettler.SALT).toString(ShaUtils.hexEncoder);
  }

  /**
   * The chain is committed forward and revealed backwards: each round hash is the sha256 of the hash of
   * the round that follows it.
   */
  static getPreviousRoundHash(hash) {
    return ShaUtils.sha256(ShaUtils.hexEncoder.parse(hash)).toString();
  }
}

const normalizeMultiplier = (multiplier) => `${multiplier.toFixed(2)}x`;

const normalizeBoost = (boost) => `x${(boost / BoostTable.UNIT_BOOST).toFixed(2)}`;

let appState = {
  hash: '',
  limit: 50,
  results: [],
  selectedRound: 0,
  showExplanation: true,
};

function calculateResults() {
  const results = [];
  let closuredHash = appState.hash;

  for (let round = 0; round < appState.limit; round++) {
    const crashMultiplier = RoundSettler.computeCrashMultiplier(closuredHash);
    const boost = BoostTable.drawBoost(closuredHash);
    const topCashout = RoundSettler.topCashoutMultiplier(crashMultiplier);

    results.push({
      hash: closuredHash,
      crashMultiplier,
      boost,
      topCashout,
      topPayout: topCashout === null ? null : RoundSettler.payoutMultiplier(topCashout, boost),
    });

    closuredHash = RoundSettler.getPreviousRoundHash(closuredHash);
  }

  appState.results = results;
  renderResults();
}

function renderResults() {
  renderRounds();
  renderExplanation();
}

function renderRounds() {
  const roundsContainer = document.getElementById('rounds-container');

  if (!appState.results.length) {
    roundsContainer.innerHTML = '';
    return;
  }

  const rowsHTML = appState.results
    .map((result, round) => {
      const isSelected = appState.selectedRound === round;
      const isBust = result.topCashout === null;

      return `
        <div class="outcome-wrapper ${isSelected ? 'selected' : ''}" onclick="selectRound(${round})">
          <div class="hash-wrapper">${result.hash}</div>
          <div class="outcome-values">
            <div class="outcome-value ${isBust ? 'bust' : ''}">${normalizeMultiplier(result.crashMultiplier)}</div>
            <div class="outcome-value boost">${normalizeBoost(result.boost)}</div>
            <div class="outcome-value payout">${isBust ? '—' : normalizeMultiplier(result.topPayout)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  roundsContainer.innerHTML = `
    <div class="outcome-header">
      <div class="hash-wrapper">Round hash</div>
      <div class="outcome-values">
        <div class="outcome-value">Crash</div>
        <div class="outcome-value">Boost</div>
        <div class="outcome-value">Top payout</div>
      </div>
    </div>
    ${rowsHTML}
    <button class="button show-more" onclick="handleShowMore()">Show more</button>
  `;
}

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');

  if (!appState.results.length || appState.results.length <= appState.selectedRound) {
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

  const round = appState.selectedRound;
  const result = appState.results[round];

  const crashMessage = `${result.hash}${RoundSettler.CRASH_MESSAGE_SUFFIX}`;
  const crashHmac = RoundSettler.hmac(crashMessage);
  const crashRange = crashHmac.slice(0, RoundSettler.HEX_CHARS_USED);
  const crashRaw = parseInt(crashRange, 16);
  const x = RoundSettler.uniform(crashMessage);
  const base = RoundSettler.baseRtpPercent();

  const boostMessage = `${result.hash}${BoostTable.BOOST_MESSAGE_SUFFIX}`;
  const boostHmac = RoundSettler.hmac(boostMessage);
  const boostRange = boostHmac.slice(0, RoundSettler.HEX_CHARS_USED);
  const boostRaw = parseInt(boostRange, 16);
  const boostDraw = BoostTable.draw(result.hash);

  explanationContainer.innerHTML = `
    <div class="calculation-explanation">
      <h3>Explanation for Round ${round + 1}</h3>

      <div class="round-explanation">
        <div class="explanation-step">
          <h4>Step 1: Derive the crash base from the boost table</h4>
          <p>The crash draw is not priced at the game RTP. It is priced at the game RTP divided by the mean boost:</p>
          <pre>meanBoost = ${BoostTable.WEIGHTED_TOTAL} / ${BoostTable.WEIGHT_TOTAL} / 100 = ${(BoostTable.WEIGHTED_TOTAL / BoostTable.WEIGHT_TOTAL / BoostTable.UNIT_BOOST).toFixed(6)}
base = ${getRTP()} / ${(BoostTable.WEIGHTED_TOTAL / BoostTable.WEIGHT_TOTAL / BoostTable.UNIT_BOOST).toFixed(6)} = ${RoundSettler.baseRtpPercent()}</pre>
        </div>

        <div class="explanation-step">
          <h4>Step 2: Get HMAC-SHA256 of the crash message</h4>
          <p>The round hash is suffixed so the crash draw and the boost draw never share a number:</p>
          <pre>hmacSha256("${crashMessage}", SALT) = ${crashHmac}</pre>
        </div>

        <div class="explanation-step">
          <h4>Step 3: Read the first ${RoundSettler.HEX_CHARS_USED} hex characters as a ${RoundSettler.N_BITS}-bit fraction</h4>
          <pre>range = ${crashRange}
r = ${crashRaw}
x = ${crashRaw} / 2^${RoundSettler.N_BITS} = ${x}</pre>
          <p>The fraction is rounded to 9 significant digits before it is used.</p>
        </div>

        <div class="explanation-step">
          <h4>Step 4: Turn the fraction into the crash point</h4>
          <pre>multiplier = ${base} / (1 - ${x}) = ${base / (1 - x)}
floor(${base / (1 - x)}) / 100 = ${Math.floor(base / (1 - x)) / RoundSettler.MULTIPLIER_SCALE}
crash = max(${RoundSettler.MIN_MULTIPLIER.toFixed(2)}, min(${RoundSettler.MAX_MULTIPLIER.toFixed(2)}, ${Math.floor(base / (1 - x)) / RoundSettler.MULTIPLIER_SCALE})) = <b>${normalizeMultiplier(result.crashMultiplier)}</b></pre>
          <p>
            The ceiling sits one counter step above the highest payable value, so
            ${normalizeMultiplier(RoundSettler.maxCashoutMultiplier())} can always be won.
          </p>
        </div>

        <div class="explanation-step">
          <h4>Step 5: Draw the board's boost from the same hash</h4>
          <pre>hmacSha256("${boostMessage}", SALT) = ${boostHmac}
range = ${boostRange}
r = ${boostRaw}
draw = ${boostRaw} % ${BoostTable.WEIGHT_TOTAL} = ${boostDraw}</pre>
          <div class="base-row-container">
            ${BoostTable.BOOSTS
              .map((boost, index) => `
                <span class="base-row-item">
                  <span class="item-index">&lt; ${BoostTable.CUMULATIVE_WEIGHTS[index]}</span>
                  <span class="item-value ${boost === result.boost ? 'item-drawn' : ''}">${normalizeBoost(boost)}</span>
                </span>
              `)
              .join('')}
          </div>
          <p>First slot whose cumulative weight exceeds the draw: <strong>${normalizeBoost(result.boost)}</strong></p>
        </div>

        <div class="explanation-step">
          <h4>Step 6: Price the round</h4>
          ${result.topCashout === null
            ? `<p>
                 The counter died at ${normalizeMultiplier(result.crashMultiplier)}, at or below the cash-out floor of
                 ${normalizeMultiplier(RoundSettler.minCashoutMultiplier())}. Nothing could be banked this round.
               </p>`
            : `<p>A cash-out lands strictly before the crash, so the highest counter this round could pay is:</p>
               <pre>topCounter = min(${normalizeMultiplier(result.crashMultiplier)} - 0.01, ${normalizeMultiplier(RoundSettler.maxCashoutMultiplier())}) = ${normalizeMultiplier(result.topCashout)}
topPayout = ${normalizeMultiplier(result.topCashout)} &times; ${normalizeBoost(result.boost)} = <b>${normalizeMultiplier(result.topPayout)}</b></pre>
               <p>
                 A bet banked at any counter <b>c</b> in
                 [${normalizeMultiplier(RoundSettler.minCashoutMultiplier())}, ${normalizeMultiplier(result.topCashout)}]
                 pays <b>c &times; ${normalizeBoost(result.boost)}</b> per unit stake.
               </p>`}
        </div>

        <div class="explanation-step">
          <h4>Step 7: Walk back to the previous round</h4>
          <pre>sha256(${result.hash}) = ${RoundSettler.getPreviousRoundHash(result.hash)}</pre>
          <p>The hash is hashed as bytes, not as text.</p>
        </div>
      </div>

      <div class="toggle-explanation">
        <button class="button" onclick="hideExplanation()">
          Hide Explanation
        </button>
      </div>
    </div>
  `;
}

function selectRound(round) {
  appState.selectedRound = round;
  appState.showExplanation = true;
  renderRounds();
  renderExplanation();
}

function showExplanation() {
  appState.showExplanation = true;
  renderExplanation();
}

function hideExplanation() {
  appState.showExplanation = false;
  renderExplanation();
}

function handleShowMore() {
  appState.limit += 50;
  calculateResults();
}

function handleHashChange(event) {
  appState.hash = event.target.value.trim();

  if (!appState.hash) {
    appState.results = [];
    appState.limit = 50;
    appState.selectedRound = 0;
    renderResults();
    return;
  }

  calculateResults();
}

function initApp() {
  const hashInput = document.getElementById('hash-input');
  hashInput.addEventListener('input', handleHashChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
