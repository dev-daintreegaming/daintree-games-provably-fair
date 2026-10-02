class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

// Mirrors SwipeGirlsLadderTable: frozen ladders (multiplier cents) and survival thresholds over 2^32.
class LadderTable {
  static U32_RANGE = 2 ** 32;
  static RTP_MIN = 95;
  static RTP_MAX = 99;
  static MYSTERY_RATE = 0.05;
  static MYSTERY_THRESHOLD = Math.round(this.MYSTERY_RATE * this.U32_RANGE);

  static LADDER_CENTS = {
    EASY: [
      101, 107, 113, 121, 129, 138, 149, 160, 174, 190, 208, 230,
      256, 287, 326, 375, 438, 523, 640, 813, 1088, 1578, 2643, 6212,
    ],
    EXTREME: [
      139, 207, 317, 500, 819, 1396, 2505, 4778,
      9836, 22329, 57777, 180072, 751803, 5525756,
    ],
  };

  static getMaxSteps(mode) {
    return this.LADDER_CENTS[mode].length;
  }

  // 1-based step → multiplier (e.g. EASY step 1 → 1.01).
  static getMultiplier(mode, step) {
    return this.LADDER_CENTS[mode][step - 1] / 100;
  }

  // Step 1 carries the RTP scale (rtp / cents[0]), every later step is the ladder ratio cents[k-1] / cents[k].
  static getSurvivalProbability(mode, step, rtp) {
    const cents = this.LADDER_CENTS[mode];
    return step === 1 ? rtp / cents[0] : cents[step - 2] / cents[step - 1];
  }

  static getSurvivalThreshold(mode, step, rtp) {
    return Math.round(this.getSurvivalProbability(mode, step, rtp) * this.U32_RANGE);
  }
}

// Mirrors SwipeGirlsCardGenerator: card j = hex chars [16j, 16j + 16) of the joined round hashes.
class CardGenerator {
  static SHA512_HASH_LENGTH = 128;
  static CHARS_PER_CARD = 16;
  static CHARS_PER_DRAW = 8;
  static INITIAL_SKIPS = 3;

  // Worst case number of cards one round can consume: every step liked plus the whole skip pool.
  static deckSize(mode) {
    return 2 * LadderTable.getMaxSteps(mode) + this.INITIAL_SKIPS + 1;
  }

  static requiredHashCount(maxCards) {
    return Math.ceil((maxCards * this.CHARS_PER_CARD) / this.SHA512_HASH_LENGTH);
  }

  // Round hashes: hmacSha512("clientSeed:nonce:i", serverSeed) for i in [0, hashCount).
  static calculateHashes(serverSeed, clientSeed, nonce, mode) {
    const hashCount = this.requiredHashCount(this.deckSize(mode));
    const hashes = [];

    for (let i = 0; i < hashCount; i++) {
      hashes.push(ShaUtils.hmacSha512(`${clientSeed}:${nonce}:${i}`, serverSeed).toString());
    }

    return hashes;
  }

  static getCards(hashes, mode) {
    const stream = hashes.join('');
    const cards = [];

    for (let index = 0; index < this.deckSize(mode); index++) {
      const from = index * this.CHARS_PER_CARD;
      const hex = stream.slice(from, from + this.CHARS_PER_CARD);
      const survivalHex = hex.slice(0, this.CHARS_PER_DRAW);
      const mysteryHex = hex.slice(this.CHARS_PER_DRAW);

      cards.push({
        index,
        hex,
        survivalHex,
        mysteryHex,
        survivalDraw: parseInt(survivalHex, 16),
        mysteryDraw: parseInt(mysteryHex, 16),
      });
    }

    return cards;
  }
}

// Mirrors SwipeGirlsOutcomeEvaluator.
class OutcomeEvaluator {
  static evaluate(card, mode, step, rtp) {
    const threshold = LadderTable.getSurvivalThreshold(mode, step, rtp);
    if (card.survivalDraw >= threshold) {
      return 'REJECT';
    }
    if (card.mysteryDraw < LadderTable.MYSTERY_THRESHOLD) {
      return 'MYSTERY';
    }
    return 'MATCH';
  }
}

// Skips as the bet details list them: the step each skip was taken on, separated by anything
// reasonable, repeated once per skip taken on that same step.
function parseSkipSteps(raw) {
  const text = String(raw).trim();
  if (!text) {
    return [];
  }

  return text.split(/[\s,;]+/).filter(Boolean).map((token) => {
    if (!/^\d+$/.test(token) || Number(token) < 1) {
      throw new Error(`Skips are a list of steps; "${token}" is not one.`);
    }

    return Number(token);
  });
}

// Replays the round over the committed card stream. A skip is the player's own choice, so it cannot
// be replayed from the seeds: it consumes the next card without applying its outcome and the attempted
// step stays the same. Every other card is liked until a REJECT or the top of the ladder.
// A skipped card still gets the outcome it would have had, and the cards left after a REJECT are
// evaluated against the next steps of the ladder, both for reference only.
class RoundSimulator {
  static simulate(cards, mode, rtp, skipSteps) {
    const maxSteps = LadderTable.getMaxSteps(mode);
    const skipCounts = new Map();
    skipSteps.forEach((step) => {
      if (step > maxSteps) {
        throw new Error(`Skip on step ${step} is out of range for ${mode}; supported: 1..${maxSteps}.`);
      }
      skipCounts.set(step, (skipCounts.get(step) || 0) + 1);
    });

    const moves = [];
    let step = 0;
    let skips = CardGenerator.INITIAL_SKIPS;
    let cursor = 0;
    let status = '';

    while (!status) {
      const attemptedStep = step + 1;
      const threshold = LadderTable.getSurvivalThreshold(mode, attemptedStep, rtp);

      for (let ordinal = 1; ordinal <= (skipCounts.get(attemptedStep) || 0); ordinal++) {
        if (skips === 0) {
          throw new Error(`Skip ${ordinal} on step ${attemptedStep} could not have been taken: no skips left.`);
        }
        skips--;
        const skippedCard = cards[cursor++];
        const wouldBe = OutcomeEvaluator.evaluate(skippedCard, mode, attemptedStep, rtp);
        moves.push({ card: skippedCard, action: 'SKIP', attemptedStep, threshold, outcome: wouldBe, step, skips });
      }

      const card = cards[cursor++];
      const outcome = OutcomeEvaluator.evaluate(card, mode, attemptedStep, rtp);
      if (outcome === 'REJECT') {
        status = 'BUST';
      } else {
        step = attemptedStep;
        if (outcome === 'MYSTERY') {
          skips++;
        }
        if (step === maxSteps) {
          status = 'MAX_STEP';
        }
      }
      moves.push({ card, action: 'LIKE', attemptedStep, threshold, outcome, step, skips });
    }

    const unreached = [...skipCounts.keys()].filter((skipStep) => skipStep > step + 1);
    if (unreached.length) {
      throw new Error(`Skips on step ${unreached.join(', ')} could not have been taken: the round ended on step ${step + 1}.`);
    }

    const future = [];
    if (status === 'BUST') {
      for (let futureStep = step + 2; futureStep <= maxSteps && cursor < cards.length; futureStep++) {
        const card = cards[cursor++];
        const threshold = LadderTable.getSurvivalThreshold(mode, futureStep, rtp);
        const outcome = OutcomeEvaluator.evaluate(card, mode, futureStep, rtp);
        future.push({ card, action: '', attemptedStep: futureStep, threshold, outcome });
      }
    }

    return { moves, future, step, skips, status };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  mode: 'EASY',
  skipSteps: '',
  sha256: '',
  hashes: [],
  cards: [],
  round: null,
  error: '',
  showExplanation: true
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMultiplier(mode, step) {
  return step === 0 ? '0.00' : LadderTable.getMultiplier(mode, step).toFixed(2);
}

function updateResults() {
  appState.sha256 = '';
  appState.hashes = [];
  appState.cards = [];
  appState.round = null;
  appState.error = '';

  if (appState.serverSeed && appState.nonce && appState.clientSeed) {
    try {
      appState.sha256 = ShaUtils.sha256(appState.serverSeed).toString();
      appState.hashes = CardGenerator.calculateHashes(appState.serverSeed, appState.clientSeed, appState.nonce, appState.mode);
      appState.cards = CardGenerator.getCards(appState.hashes, appState.mode);
      appState.round = RoundSimulator.simulate(
        appState.cards,
        appState.mode,
        getRTP(),
        parseSkipSteps(appState.skipSteps)
      );
    } catch (error) {
      console.error('Error calculating results:', error);
      appState.error = error.message;
    }
  }

  renderResults();
}

function renderResults() {
  document.getElementById('sha256-input').value = appState.sha256;

  renderRound();
  renderDeck();
  renderExplanation();
}

function renderRound() {
  const container = document.getElementById('round-container');
  const round = appState.round;

  if (!round) {
    container.innerHTML = appState.error ? `<div class="error">${escapeHtml(appState.error)}</div>` : '';
    return;
  }

  const statusText = {
    BUST: `Rejected at step ${round.step + 1}: x0.00`,
    MAX_STEP: `Max step ${round.step} reached (auto cash out): x${formatMultiplier(appState.mode, round.step)}`,
  }[round.status];

  container.innerHTML = `
    <div class="round-summary">
      <div class="summary-item"><span class="summary-label">Result</span><span class="summary-value ${round.status.toLowerCase()}">${statusText}</span></div>
      <div class="summary-item"><span class="summary-label">Last reached step</span><span class="summary-value">${round.step === 0 ? '-' : `${round.step}: x${formatMultiplier(appState.mode, round.step)}`}</span></div>
      <div class="summary-item"><span class="summary-label">Steps reached</span><span class="summary-value">${round.step} / ${LadderTable.getMaxSteps(appState.mode)}</span></div>
      <div class="summary-item"><span class="summary-label">Skips left</span><span class="summary-value">${round.skips}</span></div>
      <div class="summary-item"><span class="summary-label">Cards used</span><span class="summary-value">${round.moves.length} / ${appState.cards.length}</span></div>
    </div>
    ${round.moves.length ? `
      <div class="path-display">
        <div class="path-label">Path (${round.moves.length} cards):</div>
        <div class="path-container">
          <div class="path-steps">
            ${round.moves.map((move) => `
              <div class="path-step ${move.action === 'SKIP' ? 'skipped' : move.outcome.toLowerCase()}">
                <span class="step-number">Step ${move.attemptedStep}</span>
                <span class="step-value">${move.outcome}</span>
                <span class="step-multiplier">${move.action === 'SKIP' ? '(Skip)' : move.outcome === 'REJECT' ? 'x0.00' : `x${formatMultiplier(appState.mode, move.attemptedStep)}`}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    ` : ''}
  `;
}

function renderDeck() {
  const container = document.getElementById('deck-container');
  const round = appState.round;

  if (!round) {
    container.innerHTML = '';
    return;
  }

  const movesByCard = new Map(round.moves.map((move) => [move.card.index, move]));
  const futureByCard = new Map(round.future.map((move) => [move.card.index, move]));

  container.innerHTML = `
    <div class="path-label">Committed card stream (${appState.cards.length} cards):</div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Card</th>
            <th>Hex</th>
            <th>Survival draw</th>
            <th>Mystery draw</th>
            <th>Action</th>
            <th>Attempted step</th>
            <th>Survival threshold</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          ${appState.cards.map((card) => {
            const move = movesByCard.get(card.index) || futureByCard.get(card.index);
            const played = movesByCard.has(card.index);
            const skipped = move && move.action === 'SKIP';
            return `
              <tr class="${played ? '' : 'unused'}">
                <td>${card.index}</td>
                <td class="mono">${card.hex}</td>
                <td>${card.survivalDraw}</td>
                <td>${card.mysteryDraw}</td>
                <td>${move && move.action ? move.action : '-'}</td>
                <td>${move ? move.attemptedStep : '-'}</td>
                <td>${move ? move.threshold : '-'}</td>
                <td class="${move ? `outcome ${move.outcome.toLowerCase()}${played && !skipped ? '' : ' hypothetical'}` : ''}">${move ? `${move.outcome}${skipped ? ' (Skip)' : ''}` : '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderExplanation() {
  const container = document.getElementById('explanation-container');
  const round = appState.round;

  if (!round) {
    container.innerHTML = '';
    return;
  }

  if (!appState.showExplanation) {
    container.innerHTML = `
      <div class="toggle-explanation blue">
        <button class="button" onclick="showExplanation()">
          Show Explanation
        </button>
      </div>
    `;
    return;
  }

  const { mode } = appState;
  const rtp = getRTP();
  const maxSteps = LadderTable.getMaxSteps(mode);
  const deckSize = CardGenerator.deckSize(mode);
  const ladderRows = Array.from({ length: maxSteps }, (_, i) => {
    const step = i + 1;
    const cents = LadderTable.LADDER_CENTS[mode];
    const formula = step === 1 ? `${rtp} / ${cents[0]}` : `${cents[step - 2]} / ${cents[step - 1]}`;
    return `
      <tr>
        <td>${step}</td>
        <td>x${formatMultiplier(mode, step)}</td>
        <td>${formula} = ${LadderTable.getSurvivalProbability(mode, step, rtp).toFixed(8)}</td>
        <td>${LadderTable.getSurvivalThreshold(mode, step, rtp)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="calculation-explanation">
      <h3>Explanation</h3>

      <div class="row-explanation">
        <div class="explanation-step">
          <h4>Step 1: Calculate HMAC-SHA512 round hashes</h4>
          <p>The whole card stream is committed up front. The deck has <b>2 × ${maxSteps} + ${CardGenerator.INITIAL_SKIPS} + 1 = ${deckSize}</b> cards
            (every step liked plus the whole skip pool), each card takes ${CardGenerator.CHARS_PER_CARD} hex chars, so
            <b>ceil(${deckSize} × ${CardGenerator.CHARS_PER_CARD} / ${CardGenerator.SHA512_HASH_LENGTH}) = ${appState.hashes.length}</b> hashes are needed:</p>
          ${appState.hashes.map((hash, i) => `<pre>hmacSha512("${escapeHtml(appState.clientSeed)}:${escapeHtml(appState.nonce)}:${i}", "${escapeHtml(appState.serverSeed)}") = ${hash}</pre>`).join('')}
        </div>

        <div class="explanation-step">
          <h4>Step 2: Read the cards</h4>
          <p>The hashes are joined into one stream. Card <b>j</b> occupies hex chars <b>[16j, 16j + 16)</b>:
            the first 8 chars are the unsigned 32-bit <b>survival draw</b>, the next 8 are the unsigned 32-bit <b>mystery draw</b>.</p>
          <p>Cards are revealed strictly in stream order. Both LIKE and SKIP consume the next card.</p>
        </div>

        <div class="explanation-step">
          <h4>Step 3: Survival thresholds (${mode}, RTP ${rtp}%)</h4>
          <p>Survival probability of step 1 is <b>rtp / cents[1]</b>, every later step k is <b>cents[k-1] / cents[k]</b>.
            Threshold = <b>round(probability × 2^32)</b>.</p>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Step</th><th>Multiplier</th><th>Survival probability</th><th>Threshold</th></tr>
              </thead>
              <tbody>${ladderRows}</tbody>
            </table>
          </div>
        </div>

        <div class="explanation-step">
          <h4>Step 4: Evaluate each card</h4>
          <p><b>SKIP</b>: the player's own choice, taken from the bet details. The card is consumed and its outcome is not applied:
            the attempted step stays the same, one skip is spent (start with ${CardGenerator.INITIAL_SKIPS} skips).
            The outcome it would have had is shown marked <b>(Skip)</b>.</p>
          <p><b>LIKE</b>: if <b>survivalDraw &ge; threshold(step)</b> the result is <b>REJECT</b> and the round is lost.
            Otherwise it is a <b>MATCH</b> and the step is reached; if additionally
            <b>mysteryDraw &lt; round(${LadderTable.MYSTERY_RATE} × 2^32) = ${LadderTable.MYSTERY_THRESHOLD}</b> it is a
            <b>MYSTERY</b> (match plus one skip).</p>
          <p>Every other card is liked until a REJECT. Reaching step ${maxSteps} cashes out automatically;
            a player who cashed out earlier receives the multiplier of the step they stopped on.
            Cards left after a REJECT are evaluated against the next steps for reference only (greyed out in the card stream).</p>
          ${round.moves.map((move) => `
            <div class="rate-calculation">
              <strong>Card ${move.card.index}:</strong>
              <div>Hex: <b>${move.card.survivalHex}</b> <b>${move.card.mysteryHex}</b></div>
              <div>Action: <b>${move.action}</b> (attempting step ${move.attemptedStep})</div>
              ${move.action === 'SKIP' ? `
                <div>Survival: <b>${move.card.survivalDraw} ${move.outcome === 'REJECT' ? '&ge;' : '&lt;'} ${move.threshold}</b></div>
                <div>Result: <b>${move.outcome} (Skip)</b>, not applied, skips left: <b>${move.skips}</b></div>
              ` : `
                <div>Survival: <b>${move.card.survivalDraw} ${move.outcome === 'REJECT' ? '&ge;' : '&lt;'} ${move.threshold}</b></div>
                ${move.outcome !== 'REJECT' ? `<div>Mystery: <b>${move.card.mysteryDraw} ${move.outcome === 'MYSTERY' ? '&lt;' : '&ge;'} ${LadderTable.MYSTERY_THRESHOLD}</b></div>` : ''}
                <div>Result: <b>${move.outcome}</b>${move.outcome === 'REJECT' ? '' : `, multiplier: <b>x${formatMultiplier(mode, move.step)}</b>, skips left: <b>${move.skips}</b>`}</div>
              `}
            </div>
          `).join('')}
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

function hideExplanation() {
  appState.showExplanation = false;
  renderExplanation();
}

function showExplanation() {
  appState.showExplanation = true;
  renderExplanation();
}

function initApp() {
  const bindings = [
    ['server-seed-input', 'input', 'serverSeed', (v) => v],
    ['nonce-input', 'input', 'nonce', (v) => v],
    ['client-seed-input', 'input', 'clientSeed', (v) => v],
    ['mode-select', 'change', 'mode', (v) => v],
    ['skips-input', 'input', 'skipSteps', (v) => v],
  ];

  bindings.forEach(([id, event, key, parse]) => {
    document.getElementById(id).addEventListener(event, (e) => {
      appState[key] = parse(e.target.value);
      updateResults();
    });
  });

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
