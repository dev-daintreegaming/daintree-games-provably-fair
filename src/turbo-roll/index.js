class ShaUtils {
  static hmacSha512 = CryptoJS.HmacSHA512;
  static hmacSha256 = CryptoJS.HmacSHA256;
  static sha256 = CryptoJS.SHA256;
}

const CIRCLE_SIZE = 36000;

function getRTP() {
  const urlParams = new URLSearchParams(window.location.search);
  const rtpParam = urlParams.get('rtp');
  return rtpParam ? parseInt(rtpParam, 10) : 97;
}

class AngleCalculator {
  static compute(hash) {
    const num = parseInt(hash.substring(0, 13), 16);
    return num % CIRCLE_SIZE;
  }
}

class RoundResultResolver {
  static resolveResult(angle, segmentSize) {
    return angle < segmentSize ? "WIN" : "LOSS";
  }

  static availableMultipliers = [
    1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0,
    3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 15.0, 20.0, 25.0, 30.0
  ];

  static resolveSegmentSize(multiplier) {
    if (!this.availableMultipliers.includes(parseFloat(multiplier))) {
      throw new Error(`Unsupported target multiplier: ${multiplier}`);
    }
    
    const segmentSize = Math.floor(((CIRCLE_SIZE / 100) / multiplier) * getRTP());
    return segmentSize;
  }

  static getData(serverSeed, nonce, clientSeed, targetMultiplier) {
    const sha256Hmac = ShaUtils.hmacSha256(`${clientSeed}:${nonce}`, serverSeed).toString();
    const angle = AngleCalculator.compute(sha256Hmac);
    const segmentSize = this.resolveSegmentSize(targetMultiplier);
    const result = this.resolveResult(angle, segmentSize);

    return {
      sha256: ShaUtils.sha256(serverSeed).toString(),
      sha256Hmac,
      angle,
      segmentSize,
      targetMultiplier,
      result
    };
  }
}

let appState = {
  serverSeed: '',
  nonce: '',
  clientSeed: '',
  targetMultiplier: 1.4,
  sha256: '',
  sha256Hmac: '',
  angle: null,
  segmentSize: null,
  result: null
};

function createCircleVisualization(angle, segmentSize) {
  const segmentSizeDegrees = segmentSize / 100;
  const rotationDegrees = 360 - (angle / 100);
  
  const circleContainer = document.createElement('div');
  circleContainer.className = 'circle-container';
  
  const marker = document.createElement('div');
  marker.className = 'circle-marker';
  
  const circle = document.createElement('div');
  circle.className = 'circle';
  circle.style.background = `conic-gradient(
    #339E62 0deg ${segmentSizeDegrees}deg,
    #757070 ${segmentSizeDegrees}deg 360deg
  )`;
  circle.style.transform = `rotate(${rotationDegrees}deg)`;
  
  circleContainer.appendChild(marker);
  circleContainer.appendChild(circle);
  
  return circleContainer;
}

function updateResults() {
  if (!appState.serverSeed || !appState.clientSeed) {
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.angle = null;
    appState.segmentSize = null;
    appState.result = null;
    renderResults();
    return;
  }

  try {
    const data = RoundResultResolver.getData(
      appState.serverSeed,
      appState.nonce,
      appState.clientSeed,
      parseFloat(appState.targetMultiplier)
    );

    appState.sha256 = data.sha256;
    appState.sha256Hmac = data.sha256Hmac;
    appState.angle = data.angle;
    appState.segmentSize = data.segmentSize;
    appState.result = data.result;
  } catch (error) {
    console.error('Error calculating results:', error);
    appState.sha256 = '';
    appState.sha256Hmac = '';
    appState.angle = null;
    appState.segmentSize = null;
    appState.result = null;
  }

  renderResults();
}

function renderResults() {
  const sha256Input = document.getElementById('sha256-input');
  const sha256HmacInput = document.getElementById('sha256-hmac-input');
  
  sha256Input.value = appState.sha256;
  sha256HmacInput.value = appState.sha256Hmac;

  renderVisualization();
}

function renderVisualization() {
  const resultsContainer = document.getElementById('results-container');
  
  if (appState.angle === null || appState.segmentSize === null) {
    resultsContainer.innerHTML = '';
    return;
  }

  const circleVisualization = createCircleVisualization(appState.angle, appState.segmentSize);
  
  const resultsHTML = `
    <div class="results">
      <div id="circle-visualization"></div>
      
      <div>
        <span class="text">Size of the win area segment (green area): </span>
        <span class="subtitle">${appState.segmentSize / 100}°</span>
      </div>
      
      <div>
        <span class="text">Angle calculated from hash: </span>
        <span class="subtitle">${appState.angle / 100}°</span>
      </div>
      
      <div>
        <span class="text">Result: </span>
        <span class="subtitle">${appState.result}</span>
      </div>
      
      <div class="divider"></div>
      
      <div class="details">
        <div class="step">
          <h4>Step 1: Size of the win area segment (green area) is calculated by formula:</h4>
          <div class="text">360 / targetMultiplier * RTP</div>
          <div class="text">360 / ${appState.targetMultiplier} * ${getRTP()} = <strong>${appState.segmentSize}</strong></div>
        </div>

        <div class="step">
          <h4>Step 2: To calculate angle we take first 13 symbols of the resulting sha256Hmac and convert it to decimal number:</h4>
          <div class="horizontal-scroll">
            <strong>${appState.sha256Hmac.substring(0, 13)}</strong>
            <span class="paleText">${appState.sha256Hmac.substring(13)}</span>
          </div>
          
          <div class="subtitle">
            ${parseInt(appState.sha256Hmac.substring(0, 13), 16)}
          </div>
        </div>
        
        <div class="step">
          <h4>Step 3: Then we take this number and get the remainder of the division by 36000:</h4>
          <div>
            <span class="text">
              ${parseInt(appState.sha256Hmac.substring(0, 13), 16)} % 36000 = 
            </span>
            <strong>
              ${parseInt(appState.sha256Hmac.substring(0, 13), 16) % CIRCLE_SIZE}
            </strong>
          </div>
        </div>
        
        <div class="step">
          <h4>Step 4: Then we calculate final angle for rotation by formula:</h4>
          <div>
            <span class="text">
              360° - (${appState.angle}° / 100) = 
            </span>
            <strong>
              ${360 - (appState.angle / 100)}°
            </strong>
          </div>
        </div>
        
        <div class="step">
          <h4>Step 5: After that we create a circle segment (green area) from 0° to <strong>${appState.segmentSize / 100}°</strong> (segment size from Step 1) and rotate it by <strong>${360 - (appState.angle / 100)}°</strong></h4>
        </div>
      </div>
    </div>
  `;

  resultsContainer.innerHTML = resultsHTML;
  
  // Insert the circle visualization
  const circleContainer = document.getElementById('circle-visualization');
  if (circleContainer) {
    circleContainer.appendChild(circleVisualization);
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

function handleTargetMultiplierChange(event) {
  appState.targetMultiplier = event.target.value;
  updateResults();
}

function initApp() {
  const serverSeedInput = document.getElementById('server-seed-input');
  const nonceInput = document.getElementById('nonce-input');
  const clientSeedInput = document.getElementById('client-seed-input');
  const targetMultiplierSelect = document.getElementById('target-multiplier-select');

  serverSeedInput.addEventListener('input', handleServerSeedChange);
  nonceInput.addEventListener('input', handleNonceChange);
  clientSeedInput.addEventListener('input', handleClientSeedChange);
  targetMultiplierSelect.addEventListener('change', handleTargetMultiplierChange);

  renderResults();
}

document.addEventListener('DOMContentLoaded', initApp); 