class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static sha256 = CryptoJS.SHA256;
}

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

// Frozen bonus-wheel sector table, mirrors TwistBonusWheelTable.
class TwistBonusWheelTable {
  // Sector payouts in stake units, in fixed wheel order.
  static SECTOR_MULTIPLIERS = [100.0, 200.0, 300.0, 400.0, 500.0];

  static sectorCount() {
    return this.SECTOR_MULTIPLIERS.length;
  }

  static sectorMultiplier(index) {
    return this.SECTOR_MULTIPLIERS[index];
  }

  // Expected sector payout. The sectors are equally weighted, so this is their mean. It is what the
  // fire top step is worth before the draw, which is what TwistSegmentTable.gainAt weighs against.
  static meanMultiplier() {
    const total = this.SECTOR_MULTIPLIERS.reduce((acc, multiplier) => acc + multiplier, 0);

    return total / this.SECTOR_MULTIPLIERS.length;
  }

  // The sectors are equally weighted at every RTP — the RTP adjustment lives in the fire gem
  // probability — so the wheel takes the rate of its own hash directly.
  static resolveSectorIndex(hash) {
    const rate = TwistSegmentResolver.calculateRate(hash);
    const index = Math.floor(rate * this.SECTOR_MULTIPLIERS.length);

    return Math.min(index, this.SECTOR_MULTIPLIERS.length - 1);
  }
}

// Frozen ladder catalogue, mirrors TwistSegmentTable. There is no weight table: the outcome
// probabilities are DERIVED per playfield from the ladders below and the RTP key.
class TwistSegmentTable {
  static OUTCOME_WATER_GEM = 0;
  static OUTCOME_EARTH_GEM = 1;
  static OUTCOME_FIRE_GEM = 2;
  static OUTCOME_AIR = 3;
  static OUTCOME_DEATH = 4;

  static RING_NONE = -1;
  static RING_WATER = 0;
  static RING_EARTH = 1;
  static RING_FIRE = 2;

  static OUTCOME_COUNT = 5;
  static RING_COUNT = 3;

  static OUTCOMES = [
    { index: 0, key: 'WATER_GEM', label: 'Water gem', short: 'Water' },
    { index: 1, key: 'EARTH_GEM', label: 'Earth gem', short: 'Earth' },
    { index: 2, key: 'FIRE_GEM', label: 'Fire gem', short: 'Fire' },
    { index: 3, key: 'AIR', label: 'Air', short: 'Air' },
    { index: 4, key: 'DEATH', label: 'Death', short: 'Death' },
  ];

  static RINGS = [
    { index: 0, key: 'WATER', label: 'Water' },
    { index: 1, key: 'EARTH', label: 'Earth' },
    { index: 2, key: 'FIRE', label: 'Fire' },
  ];

  // Coefficient a ring contributes at each climbing step, indexed by step - 1. A ring's coefficient
  // is the value of the step its marker stands on, never a running sum of the steps below it.
  static LADDER_VALUES = [
    [1.6, 5.0, 10.5],
    [2.5, 8.0, 16.5, 28.5, 45.0],
    [4.0, 13.0, 28.5, 53.0, 88.0, 137.5, 205.0],
  ];

  // Reward paid in stake units when a marker reaches the ring's top step. Fire pays a bonus-wheel
  // sector instead, so it carries no fixed reward here.
  static TOP_REWARDS = [7.5, 21.0, 0.0];

  static RTP_MIN = 95;
  static RTP_MAX = 99;

  // Death's share of the two non-advancing outcomes; air takes the rest.
  static NON_ADVANCING_PARTS = 4.0;

  static outcomeCount() {
    return this.OUTCOME_COUNT;
  }

  static ringCount() {
    return this.RING_COUNT;
  }

  // Ring a gem outcome advances, or RING_NONE for air and death.
  static outcomeRing(outcomeIndex) {
    switch (outcomeIndex) {
      case this.OUTCOME_WATER_GEM:
        return this.RING_WATER;
      case this.OUTCOME_EARTH_GEM:
        return this.RING_EARTH;
      case this.OUTCOME_FIRE_GEM:
        return this.RING_FIRE;
      case this.OUTCOME_AIR:
      case this.OUTCOME_DEATH:
        return this.RING_NONE;
      default:
        throw new Error(`Unknown Twist outcome index: ${outcomeIndex}.`);
    }
  }

  // Gem outcome that advances the ring.
  static gemOutcome(ring) {
    switch (ring) {
      case this.RING_WATER:
        return this.OUTCOME_WATER_GEM;
      case this.RING_EARTH:
        return this.OUTCOME_EARTH_GEM;
      case this.RING_FIRE:
        return this.OUTCOME_FIRE_GEM;
      default:
        throw new Error(`Unknown Twist ring: ${ring}.`);
    }
  }

  // Step index of the ring's top step — the reward step. A marker never rests here: reaching it
  // pays and the marker is moved back in the same spin, so persisted steps run 0..topStep-1.
  static topStep(ring) {
    return this.LADDER_VALUES[ring].length + 1;
  }

  // Highest step a marker can rest on.
  static maxRestingStep(ring) {
    return this.LADDER_VALUES[ring].length;
  }

  // Coefficient contributed by the ring with its marker on step, in stake units.
  static ladderValue(ring, step) {
    if (step <= 0) {
      return 0.0;
    }

    const values = this.LADDER_VALUES[ring];
    if (step >= values.length) {
      return values[values.length - 1];
    }

    return values[step - 1];
  }

  // Reward paid when the ring's marker reaches its top step; 0 for fire.
  static topReward(ring) {
    return this.TOP_REWARDS[ring];
  }

  // True when the ring's top step draws a bonus-wheel sector instead of paying topReward.
  static topDrawsBonusWheel(ring) {
    return ring === this.RING_FIRE;
  }

  // Step the marker is moved to after its top step paid: fire restarts from the bottom, water and
  // earth step back one so the top stays one gem away.
  static stepAfterTopReward(ring) {
    return this.topDrawsBonusWheel(ring) ? 0 : this.maxRestingStep(ring);
  }

  // Coefficient a gem on the ring adds when it is drawn with the marker resting on step: the next
  // step's ladder value, or — from the top resting step — the reward the top pays plus whatever the
  // marker's destination is worth, minus the value it leaves behind. Fire's top is weighed at the
  // bonus wheel's mean, since the sector is drawn after the fact.
  //
  // Always positive, and it is what the derivation below divides by.
  static gainAt(ring, step) {
    if (step < this.maxRestingStep(ring)) {
      return this.ladderValue(ring, step + 1) - this.ladderValue(ring, step);
    }

    const reward = this.topDrawsBonusWheel(ring)
      ? TwistBonusWheelTable.meanMultiplier()
      : this.topReward(ring);

    return reward + this.ladderValue(ring, this.stepAfterTopReward(ring)) - this.ladderValue(ring, step);
  }

  // Probability of every outcome (index-aligned with the OUTCOME_* constants, summing to 1) for a
  // spin taken from step, at the given RTP key.
  //
  // Three rules fix all five numbers, so no weight is authored anywhere:
  //   1. each gem is weighted inversely to its own gainAt, so the three contribute the same
  //      expected amount no matter which ladders are already climbed;
  //   2. air is three times death, death being the only outcome that takes a step back;
  //   3. the scale is solved so the spin's expected change equals the key.
  //
  // Rule 3 is what the game's fairness rests on. The key is not a session average: it is the return
  // of every single spin from every single playfield, so no playfield is worth more per spin than
  // any other and holding a marker anywhere earns nothing.
  //
  // The Java side derives all 192 playfields once at class init and serves them from a lookup; here
  // one spin is verified at a time, so the same derivation runs on demand.
  static outcomeProbabilities(rtp, step) {
    return this.derive(rtp, step).probabilities;
  }

  // The derivation of a single playfield, keeping the intermediates the explanation walks through.
  static derive(rtp, step) {
    if (rtp < this.RTP_MIN || rtp > this.RTP_MAX) {
      throw new Error(`Twist outcome weights not calibrated for rtp: ${rtp}.`);
    }

    if (step.length !== this.RING_COUNT) {
      throw new Error(`Twist playfield must carry ${this.RING_COUNT} rings, got: ${step.length}.`);
    }

    for (let ring = 0; ring < this.RING_COUNT; ring++) {
      if (!Number.isInteger(step[ring]) || step[ring] < 0 || step[ring] > this.maxRestingStep(ring)) {
        throw new Error(`Twist ring ${ring} cannot rest on step ${step[ring]}.`);
      }
    }

    const gain = [];
    let inverseGainSum = 0.0;
    for (let ring = 0; ring < this.RING_COUNT; ring++) {
      gain[ring] = this.gainAt(ring, step[ring]);
      inverseGainSum += 1.0 / gain[ring];
    }

    const stepBackDelta = this.stepBackDelta(step);
    const gemContribution = (rtp / 100.0 - stepBackDelta / this.NON_ADVANCING_PARTS)
      / (this.RING_COUNT - inverseGainSum * stepBackDelta / this.NON_ADVANCING_PARTS);
    const death = (1.0 - gemContribution * inverseGainSum) / this.NON_ADVANCING_PARTS;

    const probabilities = new Array(this.OUTCOME_COUNT).fill(0.0);
    for (let ring = 0; ring < this.RING_COUNT; ring++) {
      probabilities[this.gemOutcome(ring)] = gemContribution / gain[ring];
    }
    probabilities[this.OUTCOME_AIR] = (this.NON_ADVANCING_PARTS - 1.0) * death;
    probabilities[this.OUTCOME_DEATH] = death;

    return { probabilities, gain, inverseGainSum, stepBackDelta, gemContribution, death };
  }

  // Coefficient death gives up from step: never positive, and zero on an empty playfield.
  static stepBackDelta(step) {
    let delta = 0.0;
    for (let ring = 0; ring < this.RING_COUNT; ring++) {
      delta += this.ladderValue(ring, Math.max(0, step[ring] - 1)) - this.ladderValue(ring, step[ring]);
    }

    return delta;
  }

  static rtpMin() {
    return this.RTP_MIN;
  }

  static rtpMax() {
    return this.RTP_MAX;
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

  // Walks the frozen outcome order accumulating the playfield's probabilities and returns the first
  // index the rate falls in. The rate is compared directly — there is no weight total to scale by.
  static resolveSegmentIndex(hash, rtp, step) {
    const probabilities = TwistSegmentTable.outcomeProbabilities(rtp, step);
    const target = this.calculateRate(hash);

    let cumulative = 0.0;
    for (let index = 0; index < probabilities.length; index++) {
      cumulative += probabilities[index];
      if (target < cumulative) {
        return index;
      }
    }

    return probabilities.length - 1;
  }
}

// Round settlement, mirrors TwistRoundSettler. It is what carries the playfield from one nonce to
// the next, which is what lets a whole session be replayed from its seeds alone.
class TwistRoundSettler {
  // Applies one spin's resolved outcome to state in place.
  static applyOutcome(state, outcomeIndex, bonusWheelMultiplier, maxWinMultiplier) {
    const ring = TwistSegmentTable.outcomeRing(outcomeIndex);

    const application = {
      outcomeIndex,
      ring,
      payoutMultiplier: 0.0,
      topRewardedRing: TwistSegmentTable.RING_NONE,
      bonusWheelDrawn: false,
      maxWinReached: false,
    };

    if (outcomeIndex === TwistSegmentTable.OUTCOME_AIR) {
      // The spin stake was already debited; the playfield is deliberately left untouched.
      this.recalculateCoeff(state, maxWinMultiplier, application);
      return application;
    }

    if (outcomeIndex === TwistSegmentTable.OUTCOME_DEATH) {
      this.stepBackAll(state);
      this.recalculateCoeff(state, maxWinMultiplier, application);
      return application;
    }

    this.applyGem(state, ring, bonusWheelMultiplier, application);
    this.recalculateCoeff(state, maxWinMultiplier, application);

    return application;
  }

  // Coefficient of a playfield, in stake units — the sum of the three markers' ladder values.
  static coeffOf(step) {
    let coeff = 0.0;
    for (let ring = 0; ring < step.length; ring++) {
      coeff += TwistSegmentTable.ladderValue(ring, step[ring]);
    }

    return coeff;
  }

  // A step can be cashed out only while some ring stands past its first step. Taking it clears a
  // step from every non-empty ring, so it is not offered when that would wipe the playfield for
  // single steps.
  static canPartialCashout(step) {
    return step.some((value) => value >= 2);
  }

  // Amount a partial cashout pays, in stake units: the coefficient given up by stepping every
  // non-empty ring back one. Zero unless some ring stands on its second step or higher.
  static partialCashoutMultiplier(step) {
    if (!this.canPartialCashout(step)) {
      return 0.0;
    }

    const stepped = step.map((value) => Math.max(0, value - 1));

    return this.coeffOf(step) - this.coeffOf(stepped);
  }

  // Applies a partial cashout to state in place. Unlike a spin this is the player's own action —
  // nothing is drawn for it, so no hash proves it — but it moves every non-empty ring back a step,
  // and the spins after it are resolved from what it leaves behind. That is why a replay has to be
  // told it happened.
  static applyPartialCashout(state, maxWinMultiplier) {
    const payoutMultiplier = this.partialCashoutMultiplier(state.step);

    const application = {
      outcomeIndex: -1,
      ring: TwistSegmentTable.RING_NONE,
      payoutMultiplier,
      topRewardedRing: TwistSegmentTable.RING_NONE,
      bonusWheelDrawn: false,
      maxWinReached: false,
    };

    this.stepBackAll(state);
    this.recalculateCoeff(state, maxWinMultiplier, application);

    return application;
  }

  static applyGem(state, ring, bonusWheelMultiplier, application) {
    const next = state.step[ring] + 1;
    if (next < TwistSegmentTable.topStep(ring)) {
      state.step[ring] = next;
      return;
    }

    application.topRewardedRing = ring;
    if (TwistSegmentTable.topDrawsBonusWheel(ring)) {
      application.payoutMultiplier = bonusWheelMultiplier;
      application.bonusWheelDrawn = true;
    } else {
      application.payoutMultiplier = TwistSegmentTable.topReward(ring);
    }

    state.step[ring] = TwistSegmentTable.stepAfterTopReward(ring);
  }

  static stepBackAll(state) {
    for (let ring = 0; ring < state.step.length; ring++) {
      state.step[ring] = Math.max(0, state.step[ring] - 1);
    }
  }

  static recalculateCoeff(state, maxWinMultiplier, application) {
    state.coeffMultiplier = this.coeffOf(state.step);

    if (state.coeffMultiplier >= maxWinMultiplier) {
      state.coeffMultiplier = maxWinMultiplier;
      application.maxWinReached = true;
    }
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

  // Resolves and settles one spin taken from `step`, the playfield the previous nonce left behind.
  static getData(serverSeed, nonce, clientSeed, rtp, step) {
    const roundHash = ShaUtils.hmacSha512(this.roundMessage(clientSeed, nonce), serverSeed).toString();
    const bonusWheelHash = ShaUtils.hmacSha512(this.bonusWheelMessage(clientSeed, nonce), serverSeed).toString();

    const derivation = TwistSegmentTable.derive(rtp, step);
    const rate = TwistSegmentResolver.calculateRate(roundHash);
    const outcomeIndex = TwistSegmentResolver.resolveSegmentIndex(roundHash, rtp, step);
    const sectorIndex = TwistBonusWheelTable.resolveSectorIndex(bonusWheelHash);

    // The replay settles uncapped; the max-win cap is a session configuration, not part of what the
    // hashes prove.
    const state = { coeffMultiplier: TwistRoundSettler.coeffOf(step), step: step.slice() };
    const coeffBefore = state.coeffMultiplier;
    const application = TwistRoundSettler.applyOutcome(
      state,
      outcomeIndex,
      TwistBonusWheelTable.sectorMultiplier(sectorIndex),
      Number.MAX_VALUE,
    );

    return {
      kind: 'spin',
      nonce,
      roundHash,
      bonusWheelHash,
      derivation,
      probabilities: derivation.probabilities,
      rate,
      outcomeIndex,
      bonusWheelRate: TwistSegmentResolver.calculateRate(bonusWheelHash),
      sectorIndex,
      stepBefore: step.slice(),
      stepAfter: state.step.slice(),
      coeffBefore,
      coeffAfter: state.coeffMultiplier,
      application,
    };
  }

  // Settles one partial cashout taken from `step`. It carries no hash of its own — the player
  // decides when to take it — so the bet details record which nonce it followed, and that is what
  // puts it back in the right place here.
  static getPartialCashoutData(nonce, ordinal, ordinalCount, step) {
    const state = { coeffMultiplier: TwistRoundSettler.coeffOf(step), step: step.slice() };
    const coeffBefore = state.coeffMultiplier;
    const application = TwistRoundSettler.applyPartialCashout(state, Number.MAX_VALUE);

    return {
      kind: 'cashout',
      nonce,
      ordinal,
      ordinalCount,
      stepBefore: step.slice(),
      stepAfter: state.step.slice(),
      coeffBefore,
      coeffAfter: state.coeffMultiplier,
      payoutMultiplier: application.payoutMultiplier,
      application,
    };
  }
}

// Replays a whole nonce range. The playfield is not an input: the session opens empty on the
// starting nonce and every later playfield is what the event before it left behind, so the seeds,
// the range and the cash-outs taken along the way are all it takes to know the state at any point.
//
// A partial cashout is the one thing in the timeline that is not drawn from a hash, so it cannot be
// inferred from the seeds — it comes in from the bet details as the nonce it was taken after.
class SessionResolver {
  static MAX_SPINS = 1000;

  static resolveSession(serverSeed, clientSeed, startingNonce, finishNonce, rtp, partialCashoutNonces) {
    if (!Number.isInteger(startingNonce) || startingNonce < 0) {
      throw new Error(`Starting nonce must be a non-negative whole number, got: ${startingNonce}.`);
    }

    if (!Number.isInteger(finishNonce) || finishNonce < 0) {
      throw new Error(`Finish nonce must be a non-negative whole number, got: ${finishNonce}.`);
    }

    if (finishNonce < startingNonce) {
      throw new Error(`Finish nonce ${finishNonce} is before the starting nonce ${startingNonce}.`);
    }

    const length = finishNonce - startingNonce + 1;
    if (length > this.MAX_SPINS) {
      throw new Error(`Range covers ${length} spins; this page replays at most ${this.MAX_SPINS} at a time.`);
    }

    // Several cash-outs can be taken back to back after the same spin, so the nonce is allowed to
    // repeat and the count is what matters.
    const cashoutCounts = new Map();
    partialCashoutNonces.forEach((nonce) => {
      if (nonce < startingNonce || nonce > finishNonce) {
        throw new Error(
          `Partial cash-out after nonce ${nonce} falls outside the replayed range `
          + `${startingNonce}\u2013${finishNonce}.`,
        );
      }

      cashoutCounts.set(nonce, (cashoutCounts.get(nonce) || 0) + 1);
    });

    // Spins and cash-outs interleaved, in the order the playfield actually went through them.
    const events = [];
    const spins = [];
    let step = [0, 0, 0];

    for (let nonce = startingNonce; nonce <= finishNonce; nonce++) {
      const spin = RoundResultResolver.getData(serverSeed, nonce, clientSeed, rtp, step);
      step = spin.stepAfter;
      spins.push(spin);
      events.push(spin);

      const taken = cashoutCounts.get(nonce) || 0;
      for (let ordinal = 1; ordinal <= taken; ordinal++) {
        // A cash-out the game would never have offered means the range or the list is wrong, and
        // saying so beats replaying a playfield that never existed.
        if (!TwistRoundSettler.canPartialCashout(step)) {
          throw new Error(
            `Partial cash-out ${ordinal} of ${taken} after nonce ${nonce} could not have been taken: `
            + `the playfield [${step.join(', ')}] has no ring past its first step.`,
          );
        }

        const cashout = RoundResultResolver.getPartialCashoutData(nonce, ordinal, taken, step);
        step = cashout.stepAfter;
        events.push(cashout);
      }
    }

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      spins,
      events,
    };
  }
}

let appState = {
  serverSeed: '',
  clientSeed: '',
  startingNonce: '1',
  finishNonce: '20',
  partialCashouts: '',
  sha256: '',
  session: null,
  selectedIndex: 0,
  // Until an event is picked by hand the view follows the end of the range, so widening it keeps
  // showing the latest one rather than snapping back to the start.
  followsLast: true,
  error: '',
  showExplanation: true,
};

// The selected point in the timeline: a spin, or a partial cashout taken after one.
function selectedEvent() {
  return appState.session ? appState.session.events[appState.selectedIndex] : null;
}

// The spin a selection belongs to — itself, or the spin a cashout was taken after. It is what the
// hash fields show, since a cashout draws nothing of its own.
function selectedRoundSpin() {
  const event = selectedEvent();
  if (!event) {
    return null;
  }

  return event.kind === 'spin'
    ? event
    : appState.session.spins.find((spin) => spin.nonce === event.nonce) || null;
}

function eventPayout(event) {
  return event.kind === 'cashout' ? event.payoutMultiplier : event.application.payoutMultiplier;
}

// Partial cash-outs as the bet details list them: nonces the cash-out was taken after, separated by
// anything reasonable, repeated once per cash-out taken after that same nonce.
function parsePartialCashoutNonces(raw) {
  const text = String(raw).trim();
  if (!text) {
    return [];
  }

  return text.split(/[\s,;]+/).filter(Boolean).map((token) => {
    if (!/^\d+$/.test(token)) {
      throw new Error(`Partial cash-outs are a list of nonces; "${token}" is not one.`);
    }

    return Number(token);
  });
}

function cumulativeRanges(probabilities) {
  const ranges = [];
  let cumulative = 0;

  probabilities.forEach((probability) => {
    ranges.push({ from: cumulative, to: cumulative + probability });
    cumulative += probability;
  });

  return ranges;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatRate(value) {
  return value.toFixed(12);
}

function formatCoeff(value) {
  return Number(value.toFixed(4)).toString();
}

function formatPercent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

// A typographic minus, and parentheses around a negative term so a formula never reads "− -74.6".
function formatCoeffSigned(value) {
  return formatCoeff(value).replace('-', '−');
}

function formatCoeffTerm(value) {
  return value < 0 ? `(${formatCoeffSigned(value)})` : formatCoeffSigned(value);
}

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.session = null;
    appState.error = '';
    renderResults();
    return;
  }

  try {
    const session = SessionResolver.resolveSession(
      appState.serverSeed,
      appState.clientSeed,
      Number(appState.startingNonce),
      Number(appState.finishNonce),
      getRTP(),
      parsePartialCashoutNonces(appState.partialCashouts),
    );

    appState.sha256 = session.sha256;
    appState.session = session;
    appState.selectedIndex = appState.followsLast
      ? session.events.length - 1
      // Keep a hand-picked selection inside the range when it shrinks under the cursor.
      : Math.min(appState.selectedIndex, session.events.length - 1);
    appState.error = '';
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.session = null;
    appState.error = error.message;
  }

  renderResults();
}

function renderResults() {
  const spin = selectedRoundSpin();

  document.getElementById('sha256-input').value = appState.sha256;
  document.getElementById('round-hash-input').value = spin ? spin.roundHash : '';
  document.getElementById('bonus-wheel-hash-input').value = spin ? spin.bonusWheelHash : '';

  renderSession();
  renderOutcome();
  renderExplanation();
}

// The switcher: every event of the range as a chip — the spins, and the partial cash-outs taken
// between them.
function renderSession() {
  const sessionContainer = document.getElementById('session-container');

  if (!appState.session) {
    sessionContainer.innerHTML = appState.error
      ? `<div class="error">${escapeHtml(appState.error)}</div>`
      : '';
    return;
  }

  const { events } = appState.session;

  const chipsHTML = events
    .map((event, index) => {
      const selected = index === appState.selectedIndex ? 'selected' : '';
      const payout = eventPayout(event);
      const paid = payout > 0
        ? `<span class="spin-chip-paid">+${formatCoeff(payout)}x</span>`
        : '';

      if (event.kind === 'cashout') {
        return `
          <button type="button" class="spin-chip cashout ${selected}" data-index="${index}">
            <span class="spin-chip-nonce">after #${event.nonce}</span>
            <span class="spin-chip-outcome">Cash out</span>
            <span class="spin-chip-coeff">${formatCoeff(event.coeffAfter)}x</span>
            ${paid}
          </button>
        `;
      }

      const outcome = TwistSegmentTable.OUTCOMES[event.outcomeIndex];

      return `
        <button
          type="button"
          class="spin-chip ${outcome.key.toLowerCase()} ${selected}"
          data-index="${index}"
        >
          <span class="spin-chip-nonce">#${event.nonce}</span>
          <span class="spin-chip-outcome">${outcome.short}</span>
          <span class="spin-chip-coeff">${formatCoeff(event.coeffAfter)}x</span>
          ${paid}
        </button>
      `;
    })
    .join('');

  const current = events[appState.selectedIndex];
  const title = current.kind === 'cashout'
    ? `Cash-out ${current.ordinal} of ${current.ordinalCount} after nonce ${current.nonce}`
    : `Nonce ${current.nonce}`;

  sessionContainer.innerHTML = `
    <div class="session-panel">
      <div class="spin-nav">
        <button type="button" class="button nav-button" id="prev-spin-button" ${appState.selectedIndex === 0 ? 'disabled' : ''}>
          \u2039 Prev
        </button>
        <span class="subtitle spin-nav-label">
          <span>${title}</span>
          <span class="spin-nav-position">step ${appState.selectedIndex + 1} of ${events.length} \u00b7 \u2190 \u2192 to move</span>
        </span>
        <button type="button" class="button nav-button" id="next-spin-button" ${appState.selectedIndex === events.length - 1 ? 'disabled' : ''}>
          Next \u203a
        </button>
      </div>

      <div class="spin-strip" id="spin-strip">${chipsHTML}</div>
    </div>
  `;

  const strip = document.getElementById('spin-strip');
  strip.querySelectorAll('.spin-chip').forEach((chip) => {
    chip.addEventListener('click', () => selectSpin(Number(chip.dataset.index)));
  });

  document.getElementById('prev-spin-button').addEventListener('click', () => selectSpin(appState.selectedIndex - 1));
  document.getElementById('next-spin-button').addEventListener('click', () => selectSpin(appState.selectedIndex + 1));

  const selected = strip.querySelector('.spin-chip.selected');
  if (selected && selected.scrollIntoView) {
    selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function selectSpin(index) {
  if (!appState.session) {
    return;
  }

  const clamped = Math.max(0, Math.min(index, appState.session.events.length - 1));
  if (clamped === appState.selectedIndex) {
    return;
  }

  appState.selectedIndex = clamped;
  appState.followsLast = clamped === appState.session.events.length - 1;
  renderResults();
}

// The playfield as the game draws it: three concentric rings, water inside earth inside fire. A
// ring's segments are its ladder steps 1..topStep, so a marker resting on step 0 lights nothing —
// that is the whole point of the picture, an empty ring has to look empty.
const WHEEL = {
  size: 300,
  gapDegrees: 1.8,
  rings: [
    { ring: TwistSegmentTable.RING_WATER, inner: 26, outer: 62 },
    { ring: TwistSegmentTable.RING_EARTH, inner: 68, outer: 104 },
    { ring: TwistSegmentTable.RING_FIRE, inner: 110, outer: 146 },
  ],
};

// One annular sector, swept clockwise from a0 to a1 (radians, 0 = three o'clock).
function annularSector(cx, cy, innerRadius, outerRadius, a0, a1) {
  const point = (radius, angle) => [
    (cx + radius * Math.cos(angle)).toFixed(2),
    (cy + radius * Math.sin(angle)).toFixed(2),
  ];
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const [x1, y1] = point(outerRadius, a0);
  const [x2, y2] = point(outerRadius, a1);
  const [x3, y3] = point(innerRadius, a1);
  const [x4, y4] = point(innerRadius, a0);

  return `M ${x1} ${y1}`
    + ` A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}`
    + ` L ${x3} ${y3}`
    + ` A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

// What a spin did to the wheel: the segment it climbed, or the ones death made it give up.
function spinMarks(spin) {
  const { application, stepBefore, stepAfter, outcomeIndex } = spin;

  if (outcomeIndex === TwistSegmentTable.OUTCOME_DEATH) {
    return TwistSegmentTable.RINGS
      .filter((ring) => stepBefore[ring.index] > stepAfter[ring.index])
      .map((ring) => ({ ring: ring.index, segment: stepBefore[ring.index], kind: 'lost' }));
  }

  if (application.ring === TwistSegmentTable.RING_NONE) {
    return [];
  }

  // A gem that reached the top step marks the top segment, even though the marker was moved off it.
  const ring = application.ring;
  const segment = application.topRewardedRing === ring
    ? TwistSegmentTable.topStep(ring)
    : stepAfter[ring];

  return [{ ring, segment, kind: 'gained' }];
}

// What an event did to the wheel. A cashout gives up the step every non-empty ring stood on, the
// same shape death leaves behind — but it is paid for, so it is marked apart from it.
function eventMarks(event) {
  if (event.kind !== 'cashout') {
    return spinMarks(event);
  }

  return TwistSegmentTable.RINGS
    .filter((ring) => event.stepBefore[ring.index] > event.stepAfter[ring.index])
    .map((ring) => ({ ring: ring.index, segment: event.stepBefore[ring.index], kind: 'cashed' }));
}

function playfieldWheelHTML(step, marks) {
  const size = WHEEL.size;
  const centre = size / 2;
  const toRadians = (degrees) => (degrees - 90) * Math.PI / 180;
  const markOf = (ring, stepIndex) =>
    marks.find((mark) => mark.ring === ring && mark.segment === stepIndex);

  const parts = WHEEL.rings.map(({ ring, inner, outer }) => {
    const segmentCount = TwistSegmentTable.topStep(ring);
    const current = step[ring];
    const sweep = 360 / segmentCount;
    const key = TwistSegmentTable.RINGS[ring].key.toLowerCase();

    return Array.from({ length: segmentCount }, (_, index) => {
      const stepIndex = index + 1;
      const a0 = toRadians(index * sweep + WHEEL.gapDegrees / 2);
      const a1 = toRadians(stepIndex * sweep - WHEEL.gapDegrees / 2);
      const isTop = stepIndex === TwistSegmentTable.topStep(ring);
      const mark = markOf(ring, stepIndex);

      const state = [key];
      if (stepIndex <= current) state.push('climbed');
      if (isTop) state.push('reward');
      if (mark) state.push(mark.kind);

      const middle = (a0 + a1) / 2;
      const labelRadius = (inner + outer) / 2;
      const label = isTop
        ? (TwistSegmentTable.topDrawsBonusWheel(ring) ? 'Bonus' : `+${TwistSegmentTable.topReward(ring)}x`)
        : `${TwistSegmentTable.ladderValue(ring, stepIndex)}x`;

      // The label carries the state classes but never `wheel-segment` — that one strokes its shape,
      // and a stroked <text> comes out looking doubled.
      return `
        <path class="wheel-segment ${state.join(' ')}" d="${annularSector(centre, centre, inner, outer, a0, a1)}"></path>
        <text
          class="wheel-label ${state.join(' ')}"
          x="${(centre + labelRadius * Math.cos(middle)).toFixed(2)}"
          y="${(centre + labelRadius * Math.sin(middle)).toFixed(2)}"
        >${label}</text>
      `;
    }).join('');
  }).join('');

  return `
    <div class="wheel-wrapper">
      <svg class="wheel" viewBox="0 0 ${size} ${size}" role="img"
           aria-label="Playfield: water ${step[0]}, earth ${step[1]}, fire ${step[2]}">
        ${parts}
        <circle class="wheel-hub" cx="${centre}" cy="${centre}" r="22"></circle>
        <text class="wheel-hub-value" x="${centre}" y="${centre}">${formatCoeff(TwistRoundSettler.coeffOf(step))}x</text>
      </svg>
      ${wheelLegendHTML(step, marks)}
    </div>
  `;
}

function wheelLegendHTML(step, marks) {
  const gained = marks.find((mark) => mark.kind === 'gained');
  const lost = marks.filter((mark) => mark.kind === 'lost');
  const cashed = marks.filter((mark) => mark.kind === 'cashed');
  const ringList = (items) => items
    .map((mark) => `${TwistSegmentTable.RINGS[mark.ring].label.toLowerCase()} ${mark.segment}`)
    .join(', ');

  const thisSpinHTML = (() => {
    if (gained) {
      const ring = TwistSegmentTable.RINGS[gained.ring];
      const isTop = gained.segment === TwistSegmentTable.topStep(gained.ring);

      return `
        <div class="wheel-legend-row">
          <span class="wheel-swatch gained ${ring.key.toLowerCase()}"></span>
          <span>
            climbed on this spin — ${ring.label.toLowerCase()} step ${gained.segment}
            ${isTop ? '(the top step: it paid, and the marker was moved off it)' : ''}
          </span>
        </div>
      `;
    }

    if (cashed.length) {
      return `
        <div class="wheel-legend-row">
          <span class="wheel-swatch cashed"></span>
          <span>cashed out on this step — ${ringList(cashed)}</span>
        </div>
      `;
    }

    if (lost.length) {
      return `
        <div class="wheel-legend-row">
          <span class="wheel-swatch lost"></span>
          <span>given up on this spin — ${ringList(lost)}</span>
        </div>
      `;
    }

    return '<div class="wheel-legend-row"><span class="wheel-swatch none"></span><span>nothing moved on this spin</span></div>';
  })();

  return `
    <div class="wheel-legend">
      <div class="wheel-legend-row">
        <span class="wheel-swatch climbed"></span>
        <span>climbed so far, each ring in its own colour</span>
      </div>
      ${thisSpinHTML}
      <div class="wheel-legend-steps">
        water ${step[0]}/${TwistSegmentTable.maxRestingStep(0)} ·
        earth ${step[1]}/${TwistSegmentTable.maxRestingStep(1)} ·
        fire ${step[2]}/${TwistSegmentTable.maxRestingStep(2)} ·
        coefficient ${formatCoeff(TwistRoundSettler.coeffOf(step))}x
      </div>
    </div>
  `;
}

// A cashout has no symbol, no probabilities and no bonus wheel — only what it did to the playfield.
function renderCashoutOutcome(cashout) {
  const { nonce, ordinal, ordinalCount, stepBefore, stepAfter, coeffBefore, coeffAfter, payoutMultiplier } = cashout;
  const which = ordinalCount > 1 ? ` (${ordinal} of ${ordinalCount} taken there)` : '';

  return `
    <div class="result-block">
      <div class="result-line">
        <span class="text">Partial cash-out: </span>
        <span class="subtitle">taken after nonce ${nonce}${which}</span>
      </div>
      <div class="result-line">
        <span class="text">Playfield: </span>
        <span class="subtitle">[${stepBefore.join(', ')}] → [${stepAfter.join(', ')}]</span>
      </div>
      <div class="result-line">
        <span class="text">Coefficient: </span>
        <span class="subtitle">${formatCoeff(coeffBefore)}x → ${formatCoeff(coeffAfter)}x</span>
      </div>
      <div class="result-line">
        <span class="text">Paid out: </span>
        <span class="subtitle">${formatCoeff(payoutMultiplier)}x — the coefficient given up</span>
      </div>
    </div>

    <div class="text">
      The playfield after the cash-out. Nothing is drawn for it, so no hash proves it — it is here
      because it moves every non-empty ring back a step, and the spins after it are resolved from
      what it leaves behind:
    </div>
    ${playfieldWheelHTML(stepAfter, eventMarks(cashout))}
  `;
}

function renderOutcome() {
  const outcomeContainer = document.getElementById('outcome-container');
  const event = selectedEvent();

  if (!event) {
    outcomeContainer.innerHTML = '';
    return;
  }

  if (event.kind === 'cashout') {
    outcomeContainer.innerHTML = renderCashoutOutcome(event);
    return;
  }

  const spin = event;
  const {
    nonce,
    probabilities,
    outcomeIndex,
    sectorIndex,
    stepBefore,
    stepAfter,
    coeffBefore,
    coeffAfter,
    application,
  } = spin;

  const ranges = cumulativeRanges(probabilities);
  const outcome = TwistSegmentTable.OUTCOMES[outcomeIndex];

  const outcomesHTML = TwistSegmentTable.OUTCOMES
    .map((item) => `
      <div class="outcome-card ${item.key.toLowerCase()} ${item.index === outcomeIndex ? 'resolved' : ''}">
        <div class="outcome-label">${item.label}</div>
        <div class="outcome-weight">p = ${formatPercent(probabilities[item.index])}</div>
        <div class="outcome-range">[${ranges[item.index].from.toFixed(6)}, ${ranges[item.index].to.toFixed(6)})</div>
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

  const payoutHTML = application.payoutMultiplier > 0
    ? `
      <div class="result-line">
        <span class="text">Paid this spin: </span>
        <span class="subtitle">
          ${formatCoeff(application.payoutMultiplier)}x
          ${application.bonusWheelDrawn ? '(bonus-wheel sector)' : '(top-of-ladder reward)'}
        </span>
      </div>
    `
    : '';

  outcomeContainer.innerHTML = `
    <div class="result-block">
      <div class="result-line">
        <span class="text">Nonce ${nonce} symbol: </span>
        <span class="subtitle">${outcome.label} (index ${outcomeIndex})</span>
      </div>
      <div class="result-line">
        <span class="text">Playfield: </span>
        <span class="subtitle">[${stepBefore.join(', ')}] → [${stepAfter.join(', ')}]</span>
      </div>
      <div class="result-line">
        <span class="text">Coefficient: </span>
        <span class="subtitle">${formatCoeff(coeffBefore)}x → ${formatCoeff(coeffAfter)}x</span>
      </div>
      ${payoutHTML}
    </div>

    <div class="text">
      The playfield after this spin — everything climbed so far, with what nonce ${nonce} just added:
    </div>
    ${playfieldWheelHTML(stepAfter, eventMarks(spin))}

    <div class="text">
      Probabilities derived for this playfield at RTP ${getRTP()}:
    </div>
    <div class="outcome-cards">${outcomesHTML}</div>

    <div class="text">
      Bonus wheel for this nonce — drawn only when a spin moves the fire marker onto the top of its ring
      ${application.bonusWheelDrawn ? '(drawn this spin)' : '(not drawn this spin)'}:
    </div>
    <div class="sectors">${sectorsHTML}</div>
    <div class="subtitle">Sector ${sectorIndex} — ${TwistBonusWheelTable.sectorMultiplier(sectorIndex)}x</div>
  `;
}

// A cashout is the one step of the timeline that is not proved by a hash, so its walkthrough is
// about the arithmetic and about why the replay has to be told it happened at all.
function cashoutExplanationHTML(cashout) {
  const { nonce, ordinal, ordinalCount, stepBefore, stepAfter, coeffBefore, coeffAfter, payoutMultiplier } = cashout;

  const ringRowsHTML = TwistSegmentTable.RINGS
    .map((ring) => {
      const before = stepBefore[ring.index];
      const after = stepAfter[ring.index];
      const given = TwistSegmentTable.ladderValue(ring.index, before) - TwistSegmentTable.ladderValue(ring.index, after);

      return `
        <div class="walk-row ${before > after ? 'resolved' : ''}">
          <span class="walk-label">${ring.label}</span>
          <span class="walk-weight">step ${before} → ${after}</span>
          <span class="walk-cumulative">
            ${formatCoeff(TwistSegmentTable.ladderValue(ring.index, before))}
            − ${formatCoeff(TwistSegmentTable.ladderValue(ring.index, after))}
          </span>
          <span class="walk-comparison">
            ${before > after ? `gives up <b>${formatCoeff(given)}</b>` : 'already empty — nothing to give up'}
          </span>
        </div>
      `;
    })
    .join('');

  const which = ordinalCount > 1 ? ` (${ordinal} of ${ordinalCount} taken after that nonce)` : '';

  return `
    <div class="calculation-explanation">
      <h3>Partial cash-out taken after nonce ${nonce}${which}</h3>

      <p>
        Every other step of this replay comes out of a hash. This one does not: a partial cash-out is
        the player's own action, taken between spins, so there is nothing to verify about it. It is
        entered by hand from the bet details because it moves the playfield, and a playfield that is
        wrong here makes every spin after it replay wrong too.
      </p>

      <div class="explanation-step">
        <h4>Step 1: It was available</h4>
        <p>
          A step can be cashed out only while some ring stands past its first step, so that giving
          one up from every non-empty ring is not just clearing the board. The playfield was
          [${stepBefore.join(', ')}].
        </p>
      </div>

      <div class="explanation-step">
        <h4>Step 2: Every non-empty ring gives up a step</h4>
        <div class="walk">${ringRowsHTML}</div>
        <p>Playfield [${stepBefore.join(', ')}] → <b>[${stepAfter.join(', ')}]</b>.</p>
      </div>

      <div class="explanation-step">
        <h4>Step 3: The coefficient given up is what is paid</h4>
        <p>
          ${formatCoeff(coeffBefore)}x − ${formatCoeff(coeffAfter)}x = <b>${formatCoeff(payoutMultiplier)}x</b>
          — a coefficient is the sum of the three markers' ladder values, so the payout is simply the
          difference between the playfield before and the one after.
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

function renderExplanation() {
  const explanationContainer = document.getElementById('explanation-container');
  const event = selectedEvent();

  if (!event) {
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

  if (event.kind === 'cashout') {
    explanationContainer.innerHTML = cashoutExplanationHTML(event);
    return;
  }

  const spin = event;
  const {
    nonce,
    roundHash,
    bonusWheelHash,
    derivation,
    probabilities,
    rate,
    outcomeIndex,
    bonusWheelRate,
    sectorIndex,
    stepBefore,
    stepAfter,
    coeffBefore,
    coeffAfter,
    application,
  } = spin;

  const { gain, inverseGainSum, stepBackDelta, gemContribution, death } = derivation;
  const rtp = getRTP();
  const parts = TwistSegmentTable.NON_ADVANCING_PARTS;
  const serverSeed = escapeHtml(appState.serverSeed);
  // Neighbours in the timeline, not in the nonce range: a cash-out can sit on either side of a spin
  // and it is what the playfield actually came from, or went to.
  const previousEvent = appState.session.events[appState.selectedIndex - 1] || null;
  const nextEvent = appState.session.events[appState.selectedIndex + 1] || null;

  const rateHex = roundHash.slice(0, TwistSegmentResolver.RATE_HEX_DIGITS);
  const rateTermsHTML = Array.from(rateHex)
    .map((char, index) => `${parseInt(char, 16)} / 16<sup>${index + 1}</sup>`)
    .join(' + ');

  const ringRowsHTML = TwistSegmentTable.RINGS
    .map((ring) => {
      const step = stepBefore[ring.index];
      const atTop = step === TwistSegmentTable.maxRestingStep(ring.index);
      const source = atTop
        ? `top step: ${TwistSegmentTable.topDrawsBonusWheel(ring.index)
            ? `wheel mean ${TwistBonusWheelTable.meanMultiplier()}x`
            : `reward ${TwistSegmentTable.topReward(ring.index)}x`}
           + ${TwistSegmentTable.ladderValue(ring.index, TwistSegmentTable.stepAfterTopReward(ring.index))}
           − ${TwistSegmentTable.ladderValue(ring.index, step)}`
        : `${TwistSegmentTable.ladderValue(ring.index, step + 1)} − ${TwistSegmentTable.ladderValue(ring.index, step)}`;

      return `
        <div class="walk-row resolved">
          <span class="walk-label">${ring.label}</span>
          <span class="walk-weight">step ${step}</span>
          <span class="walk-cumulative">gain ${source} = <b>${formatCoeff(gain[ring.index])}</b></span>
          <span class="walk-comparison">1 / gain = ${(1 / gain[ring.index]).toFixed(8)}</span>
        </div>
      `;
    })
    .join('');

  const ranges = cumulativeRanges(probabilities);
  const walkHTML = TwistSegmentTable.OUTCOMES
    .map((item) => {
      const range = ranges[item.index];
      const isResolved = item.index === outcomeIndex;
      const comparison = (() => {
        if (isResolved) {
          return `${rate.toFixed(8)} &lt; ${range.to.toFixed(8)} → <strong>${item.label}</strong>`;
        }

        // The walk stops on the resolved outcome, so the rows below it are never compared.
        return item.index < outcomeIndex
          ? `${rate.toFixed(8)} ≥ ${range.to.toFixed(8)} → keep walking`
          : 'not reached';
      })();

      return `
        <div class="walk-row ${isResolved ? 'resolved' : ''}">
          <span class="walk-label">${item.index}. ${item.label}</span>
          <span class="walk-weight">+${probabilities[item.index].toFixed(8)}</span>
          <span class="walk-cumulative">cumulative ${range.to.toFixed(8)}</span>
          <span class="walk-comparison">${comparison}</span>
        </div>
      `;
    })
    .join('');

  const wheelRateHex = bonusWheelHash.slice(0, TwistSegmentResolver.RATE_HEX_DIGITS);
  const sectorCount = TwistBonusWheelTable.sectorCount();

  const playfieldSourceHTML = (() => {
    if (!previousEvent) {
      return `<p>
                This is the first spin of the range, so it is taken from an empty playfield
                [${stepBefore.join(', ')}] — every session opens with all three markers at the bottom.
              </p>`;
    }

    if (previousEvent.kind === 'cashout') {
      return `<p>
                The playfield is not an input: [${stepBefore.join(', ')}] is what the partial cash-out
                taken after nonce ${previousEvent.nonce} left behind — the step before this one in the
                strip above.
              </p>`;
    }

    return `<p>
              The playfield is not an input: [${stepBefore.join(', ')}] is exactly what the spin on nonce
              ${previousEvent.nonce} left behind, which is why replaying the range from its start is
              enough to know the state here.
            </p>`;
  })();

  const settlementHTML = (() => {
    if (outcomeIndex === TwistSegmentTable.OUTCOME_AIR) {
      return '<p>Air changes nothing — the playfield is left exactly as it was.</p>';
    }

    if (outcomeIndex === TwistSegmentTable.OUTCOME_DEATH) {
      return '<p>Death steps every non-empty ring back one.</p>';
    }

    const ring = application.ring;
    const ringLabel = TwistSegmentTable.RINGS[ring].label;

    if (application.topRewardedRing === TwistSegmentTable.RING_NONE) {
      return `<p>The ${ringLabel.toLowerCase()} gem climbs its ring one step, to step ${stepAfter[ring]}.</p>`;
    }

    return `
      <p>
        The ${ringLabel.toLowerCase()} gem reaches the ring's top step ${TwistSegmentTable.topStep(ring)}, which pays
        <b>${formatCoeff(application.payoutMultiplier)}x</b>
        ${application.bonusWheelDrawn
          ? `— the sector drawn above — and restarts the marker from step ${stepAfter[ring]}`
          : `and steps the marker back to ${stepAfter[ring]}`},
        so a marker never rests on a top step.
      </p>
    `;
  })();

  explanationContainer.innerHTML = `
    <div class="calculation-explanation">
      <h3>How the spin on nonce ${nonce} is resolved</h3>

      <div class="explanation-step">
        <h4>Step 1: Get the HMAC-SHA512 hashes of the round</h4>
        <p>The spin resolves from the client seed and the nonce:</p>
        <pre>hmacSha512("${escapeHtml(RoundResultResolver.roundMessage(appState.clientSeed, nonce))}", "${serverSeed}") = ${roundHash}</pre>
        <p>
          The bonus wheel rides on the same nonce under a distinct label, so it stays verifiable on
          its own and never consumes a nonce of its own:
        </p>
        <pre>hmacSha512("${escapeHtml(RoundResultResolver.bonusWheelMessage(appState.clientSeed, nonce))}", "${serverSeed}") = ${bonusWheelHash}</pre>
      </div>

      <div class="explanation-step">
        <h4>Step 2: Take the first ${TwistSegmentResolver.RATE_HEX_DIGITS} characters of the round hash and convert them to a rate</h4>
        <div class="horizontal-scroll">
          <strong class="rate-hex">${rateHex}</strong>
          <span class="paleText">${roundHash.slice(TwistSegmentResolver.RATE_HEX_DIGITS)}</span>
        </div>
        <p>rate = ${rateTermsHTML} = <b>${formatRate(rate)}</b></p>
        <p>
          The rate is the target as it stands: the outcomes carry probabilities summing to 1, so
          there is no weight total to scale it by.
        </p>
      </div>

      <div class="explanation-step">
        <h4>Step 3: Derive this playfield's probabilities</h4>
        ${playfieldSourceHTML}
        <p>
          There is no probability table. The five numbers are derived from that playfield and the RTP
          key, by three rules:
        </p>
        <p>
          1. each gem is weighted inversely to what it gains, so all three contribute the same
          expected amount no matter which ladders are already climbed;
          2. air is ${parts - 1} times as likely as death, death being the only outcome that takes a step back;
          3. the scale is solved so this one spin returns exactly ${rtp}%.
        </p>
        <p>
          Rule 3 is what the fairness rests on: ${rtp}% is not a session average, it is the return of
          every single spin from every single playfield, so holding a marker anywhere earns nothing.
        </p>
        <div class="walk">${ringRowsHTML}</div>
        <p>Σ 1/gain = <b>${inverseGainSum.toFixed(8)}</b></p>
        <p>
          death gives up the step below every non-empty ring:
          delta = <b>${formatCoeffSigned(stepBackDelta)}</b>
        </p>
        <p>
          gemContribution = (${rtp} / 100 − ${formatCoeffTerm(stepBackDelta)} / ${parts})
          / (${TwistSegmentTable.RING_COUNT} − ${inverseGainSum.toFixed(8)} × ${formatCoeffTerm(stepBackDelta)} / ${parts})
          = <b>${gemContribution.toFixed(8)}</b>
        </p>
        <p>
          p(death) = (1 − ${gemContribution.toFixed(8)} × ${inverseGainSum.toFixed(8)}) / ${parts}
          = <b>${death.toFixed(8)}</b>,
          p(air) = ${parts - 1} × p(death) = <b>${probabilities[TwistSegmentTable.OUTCOME_AIR].toFixed(8)}</b>
        </p>
        <p>
          p(gem) = gemContribution / gain →
          water <b>${probabilities[TwistSegmentTable.OUTCOME_WATER_GEM].toFixed(8)}</b>,
          earth <b>${probabilities[TwistSegmentTable.OUTCOME_EARTH_GEM].toFixed(8)}</b>,
          fire <b>${probabilities[TwistSegmentTable.OUTCOME_FIRE_GEM].toFixed(8)}</b>
        </p>
        <p>
          The five sum to <b>${probabilities.reduce((acc, probability) => acc + probability, 0).toFixed(8)}</b>,
          and the spin's expected change is
          ${TwistSegmentTable.RING_COUNT} × gemContribution + p(death) × delta =
          <b>${(TwistSegmentTable.RING_COUNT * gemContribution + death * stepBackDelta).toFixed(8)}</b>
          — the RTP key.
        </p>
      </div>

      <div class="explanation-step">
        <h4>Step 4: Walk the symbols accumulating probabilities and take the first one the rate falls in</h4>
        <div class="walk">${walkHTML}</div>
        <p>Symbol: <strong>${TwistSegmentTable.OUTCOMES[outcomeIndex].label}</strong> (index ${outcomeIndex})</p>
      </div>

      <div class="explanation-step">
        <h4>Step 5: Resolve the bonus-wheel sector the same way</h4>
        <p>
          The five sectors are equally weighted at every RTP — the adjustment lives in the fire gem's
          probability — so the wheel takes the rate of its own hash directly:
        </p>
        <div class="horizontal-scroll">
          <strong class="rate-hex">${wheelRateHex}</strong>
          <span class="paleText">${bonusWheelHash.slice(TwistSegmentResolver.RATE_HEX_DIGITS)}</span>
        </div>
        <p>rate = <b>${formatRate(bonusWheelRate)}</b></p>
        <p>
          sector = min(floor(${formatRate(bonusWheelRate)} × ${sectorCount}), ${sectorCount - 1}) =
          <strong>${sectorIndex}</strong> → ${TwistBonusWheelTable.sectorMultiplier(sectorIndex)}x
        </p>
        <p>
          The sector is drawn for every nonce, but it is only paid when this spin moves the fire
          marker onto its top step.
        </p>
      </div>

      <div class="explanation-step">
        <h4>Step 6: Apply the symbol to the playfield</h4>
        ${settlementHTML}
        <p>
          Playfield [${stepBefore.join(', ')}] → <b>[${stepAfter.join(', ')}]</b>, coefficient
          ${formatCoeff(coeffBefore)}x → <b>${formatCoeff(coeffAfter)}x</b> — the sum of the three
          markers' ladder values, recomputed rather than accumulated.
        </p>
        <p>
          ${(() => {
            if (!nextEvent) {
              return `That playfield is where the range ends. Raise the finish nonce to carry it into nonce ${nonce + 1}.`;
            }

            if (nextEvent.kind === 'cashout') {
              return 'A partial cash-out was taken from that playfield right after this spin, so it is not '
                + 'what the next nonce sees — the next step in the strip above is the cash-out itself.';
            }

            return `That playfield is what the spin on nonce ${nextEvent.nonce} is resolved from — the next spin in the strip above.`;
          })()}
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

function handleClientSeedChange(event) {
  appState.clientSeed = event.target.value;
  updateResults();
}

function handleStartingNonceChange(event) {
  appState.startingNonce = event.target.value;
  // A new starting nonce is a different session, so the view goes back to following its last spin.
  appState.followsLast = true;
  updateResults();
}

function handleFinishNonceChange(event) {
  appState.finishNonce = event.target.value;
  updateResults();
}

function handlePartialCashoutsChange(event) {
  appState.partialCashouts = event.target.value;
  // Adding or dropping a cash-out shifts every later event along the strip, so a hand-picked
  // selection would land on something else entirely; going back to the end is the honest reset.
  appState.followsLast = true;
  updateResults();
}

// Left/right arrows step through the range, as long as a text field does not have the focus.
function handleKeyDown(event) {
  if (!appState.session || event.target.tagName === 'INPUT') {
    return;
  }

  if (event.key === 'ArrowLeft') {
    selectSpin(appState.selectedIndex - 1);
  } else if (event.key === 'ArrowRight') {
    selectSpin(appState.selectedIndex + 1);
  }
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const startingNonceInput = document.getElementById('starting-nonce-input');
  const finishNonceInput = document.getElementById('finish-nonce-input');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);

  startingNonceInput.value = appState.startingNonce;
  finishNonceInput.value = appState.finishNonce;
  startingNonceInput.addEventListener('input', handleStartingNonceChange);
  finishNonceInput.addEventListener('input', handleFinishNonceChange);

  const partialCashoutsInput = document.getElementById('partial-cashouts-input');
  partialCashoutsInput.value = appState.partialCashouts;
  partialCashoutsInput.addEventListener('input', handlePartialCashoutsChange);

  document.addEventListener('keydown', handleKeyDown);

  document.getElementById('rtp-display').textContent = `${getRTP()}%`;
  document.getElementById('max-spins-display').textContent = SessionResolver.MAX_SPINS;

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp);
