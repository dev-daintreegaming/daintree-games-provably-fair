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

const MULTIPLIER_PATTERNS_96 = {
    LOW: [1.9, 1.1, 1.1, 1.1, 0, 1.1, 1.1, 1.1, 1.1, 0],
    MEDIUM: [0, 1.8, 0, 1.4, 0, 2, 0, 1.4, 0, 3],
    HIGH: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.6],
};

const MULTIPLIER_PATTERNS_97 = {
    LOW: [2, 1.1, 1.1, 1.1, 0, 1.1, 1.1, 1.1, 1.1, 0],
    MEDIUM: [0, 1.9, 0, 1.4, 0, 2, 0, 1.4, 0, 3],
    HIGH: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.7],
};

const MULTIPLIER_PATTERNS_98= {
    LOW: [2, 1.1, 1.1, 1.1, 0, 1.1, 1.1, 1.1, 1.1, 0],
    MEDIUM: [0, 1.9, 0, 1.4, 0, 2, 0, 1.4, 0, 3],
    HIGH: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.8],
};

const MULTIPLIER_PATTERNS_99 = {
    LOW: [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0],
    MEDIUM: [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3],
    HIGH: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.9],
};

const resolveColorByMultiplier = (multiplier) => {
    if (multiplier === 0) {
        return "#737373";
    }

    if (multiplier < 1.5) {
        return "#E5E5E5";
    }

    if (multiplier < 2) {
        return "#16A34A";
    }

    if (multiplier < 3) {
        return "#EA580C";
    }

    if (multiplier < 4) {
        return "#2563EB";
    }

    return "#9333EA";
};

const MIN_SEGMENT_BLOCK = 10;

class MultiplierResolver {
    static rtp96 = MULTIPLIER_PATTERNS_96;
    static rtp97 = MULTIPLIER_PATTERNS_97;
    static rtp98 = MULTIPLIER_PATTERNS_98;
    static rtp99 = MULTIPLIER_PATTERNS_99;

    static resolveMultipliers(margin) {
        switch (margin) {
            case 1: return this.rtp99;
            case 2: return this.rtp98;
            case 3: return this.rtp97;
            case 4: return this.rtp96;
            default: throw new Error(`Multipliers not resolved for rtp ${100 - margin}`);
        }
    }

    static generateWheelSegments(segments, difficulty, margin) {
        const multipliers = this.resolveMultipliers(margin);
        const pattern = multipliers[difficulty];
        const result = [];

        const repeatCount = segments / MIN_SEGMENT_BLOCK;

        for (let i = 0; i < repeatCount; i++) {
            for (const multiplier of pattern) {
                result.push({
                    multiplier,
                    color: resolveColorByMultiplier(multiplier),
                });
            }
        }

        return result;
    }

    static getUniqueMultipliers(difficulty, margin) {
        const multipliers = this.resolveMultipliers(margin);
        const pattern = multipliers[difficulty];
        const uniqueMultipliers = [...new Set(pattern)].sort((a, b) => a - b);

        return uniqueMultipliers.map((multiplier) => ({
            multiplier,
            color: resolveColorByMultiplier(multiplier),
        }));
    }
}

function getMarginFromRTP() {
    const rtp = getRTP();
    return 100 - rtp;
}

class WheelCalculator {
  static getSegmentIndex(hash, totalSegments) {
    const num = parseInt(hash.substring(0, 13), 16);

    return num % totalSegments;
  }

  static getData(serverSeed, nonce, clientSeed, segmentCount, riskLevel) {
    const margin = getMarginFromRTP();
    const sha512Hmac = ShaUtils.hmacSha512(`${clientSeed}:${nonce}`, serverSeed).toString();
    const segments = MultiplierResolver.generateWheelSegments(segmentCount, riskLevel, margin);

    const segmentIndex = this.getSegmentIndex(sha512Hmac, segments.length);

    console.log(segmentIndex);

    const winningSegment = segments[segmentIndex];

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha512Hmac,
      segments,
      segmentIndex,
      multiplier: winningSegment.multiplier,
      color: winningSegment.color,
      result: winningSegment.multiplier > 0 ? 'WIN' : 'LOSS'
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  segmentCount: 30,
  riskLevel: 'MEDIUM',
  sha256: '',
  sha512Hmac: '',
  segments: [],
  segmentIndex: null,
  multiplier: null,
  color: null,
  result: null
};

function createCircleVisualization(segments, segmentIndex) {
  const totalSegments = segments.length;
  const segmentAngle = 360 / totalSegments;
  
  const circleContainer = document.createElement('div');
  circleContainer.className = 'circle-container';
  
  const marker = document.createElement('div');
  marker.className = 'circle-marker';
  
  const circle = document.createElement('div');
  circle.className = 'circle';
  
  let gradientParts = [];
  let currentAngle = 0;
  
  segments.forEach((segment) => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + segmentAngle;
    gradientParts.push(`${segment.color} ${startAngle}deg ${endAngle}deg`);
    currentAngle = endAngle;
  });
  
  circle.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  
  const winningAngle = segmentIndex * segmentAngle + (segmentAngle / 2);
  const rotationDegrees = 360 - winningAngle;
  circle.style.transform = `rotate(${rotationDegrees}deg)`;
  
  circleContainer.appendChild(marker);
  circleContainer.appendChild(circle);
  
  return circleContainer;
}

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha512Hmac = '';
    appState.segments = [];
    appState.segmentIndex = null;
    appState.multiplier = null;
    appState.color = null;
    appState.result = null;
    renderResults();
    return;
  }

  try {
    const data = WheelCalculator.getData(
      appState.serverSeed,
      appState.nonce,
      appState.clientSeed,
      parseInt(appState.segmentCount),
      appState.riskLevel
    );

    appState.sha256 = data.sha256;
    appState.sha512Hmac = data.sha512Hmac;
    appState.segments = data.segments;
    appState.segmentIndex = data.segmentIndex;
    appState.multiplier = data.multiplier;
    appState.color = data.color;
    appState.result = data.result;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha512Hmac = '';
    appState.segments = [];
    appState.segmentIndex = null;
    appState.multiplier = null;
    appState.color = null;
    appState.result = null;
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha512HmacInput = document.getElementById('sha512-hmac-input');
  
  sha256Input.value = appState.sha256;
  sha512HmacInput.value = appState.sha512Hmac;

  renderVisualization();
}

function renderVisualization() {
  const resultsContainer = document.getElementById('results-container');
  
  if (appState.segmentIndex === null || appState.segments.length === 0) {
    resultsContainer.innerHTML = '';
    return;
  }

  const circleVisualization = createCircleVisualization(appState.segments, appState.segmentIndex);
  const totalSegments = appState.segments.length;
  const decimalValue = parseInt(appState.sha512Hmac.substring(0, 13), 16);
  
  const resultsHTML = `
    <div class="results">
      <div id="circle-visualization"></div>
      
      <div>
        <span class="text">Winning Segment Index: </span>
        <span class="subtitle">${appState.segmentIndex}</span>
      </div>
      
      <div>
        <span class="text">Multiplier: </span>
        <span class="subtitle" style="color: ${appState.color}">${appState.multiplier}x</span>
      </div>
      
      <div>
        <span class="text">Result: </span>
        <span class="subtitle">${appState.result}</span>
      </div>
      
      <div class="divider"></div>
      
      <div class="details">
        <div class="step">
          <h4>Step 1: Generate HMAC-SHA512</h4>
          <div class="text">HMAC-SHA512(message: clientSeed:nonce, key: serverSeedHash)</div>
        </div>

        <div class="step">
          <h4>Step 2: Take first 13 characters of the hash and convert to decimal:</h4>
          <div class="horizontal-scroll">
            <strong>${appState.sha512Hmac.substring(0, 13)}</strong>
            <span class="paleText">${appState.sha512Hmac.substring(13)}</span>
          </div>
          
          <div class="subtitle">
            ${decimalValue}
          </div>
        </div>
        
        <div class="step">
          <h4>Step 3: Calculate segment index using modulo:</h4>
          <div>
            <span class="text">
              ${decimalValue} % ${totalSegments} = 
            </span>
            <strong>
              ${appState.segmentIndex}
            </strong>
          </div>
        </div>
        
        <div class="step">
          <h4>Step 4: Map segment index to multiplier:</h4>
          <div>
            <span class="text">Segment ${appState.segmentIndex} → </span>
            <strong style="color: ${appState.color}">${appState.multiplier}x</strong>
          </div>
        </div>
        
        <div class="step">
          <h4>Segment Distribution (${appState.riskLevel} risk, ${totalSegments} segments):</h4>
          <div class="segment-legend">
            ${getSegmentLegend()}
          </div>
        </div>
      </div>
    </div>
  `;

  resultsContainer.innerHTML = resultsHTML;
  
  const circleContainer = document.getElementById('circle-visualization');
  if (circleContainer) {
    circleContainer.appendChild(circleVisualization);
  }
}

function getSegmentLegend() {
  const margin = getMarginFromRTP();
  const uniqueMultipliers = MultiplierResolver.getUniqueMultipliers(appState.riskLevel, margin);
  
  if (!uniqueMultipliers.length) return '';
  
  return uniqueMultipliers.map(({ multiplier, color }) => {
    const count = appState.segments.filter(s => s.multiplier === multiplier).length;
    return `<div class="legend-item">
      <span class="legend-color" style="background: ${color}"></span>
      <span class="text">${multiplier}x: ${count} segments</span>
    </div>`;
  }).join('');
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

function handleRiskChange(event) {
  appState.riskLevel = event.target.value;
  updateResults();
}

function handleSegmentsChange(event) {
  appState.segmentCount = parseInt(event.target.value);
  updateResults();
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const riskSelect = document.getElementById('risk-input');
  const segmentsSelect = document.getElementById('segments-input');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);
  riskSelect.addEventListener('change', handleRiskChange);
  segmentsSelect.addEventListener('change', handleSegmentsChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp); 