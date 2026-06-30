const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const fpsCounter = document.getElementById("fps-counter");

// Cache Offscreen Canvas untuk performa efek pikselasi instan
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

// ===== STATE CONFIGURATION & OPTIMIZED LERP =====
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
let globalTime = 0;

const hudFrame = {
    topLeft:     { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomLeft:  { x: 0, y: 0, targetX: 0, targetY: 0 },
    topRight:    { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomRight: { x: 0, y: 0, targetX: 0, targetY: 0 },
    opacity: 0, 
    isValid: false
};

// 1. INISIALISASI MEDIAPIPE HANDS WITH ULTRA LOW COMPLEXITY
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0, // Model paling ringan
    minDetectionConfidence: 0.5, 
    minTrackingConfidence: 0.5
});

hands.onResults(onHandResults);

// 2. SOLUSI UTAMA: AKTIFKAN WEBCAM SECARA NATIVE (Tanpa camera_utils.js)
async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 45 } // Meminta frame rate tinggi dari hardware
            },
            audio: false
        });
        video.srcObject = stream;
        video.play();
        
        // Mulai render loop setelah video siap
        video.onloadedmetadata = () => {
            requestAnimationFrame(renderLoop);
        };
    } catch (err) {
        console.error("Gagal mengakses webcam: ", err);
        fpsCounter.innerText = "SYS_ERROR: NO_WEBCAM";
    }
}

// 3. ASYNCHRONOUS PROCESSING ENGINE (Anti-Blocking Loop)
let isProcessingHand = false;

async function renderLoop() {
    if (video.readyState >= 2) {
        // Jika AI sedang sibuk memproses frame sebelumnya, render visual TETAP jalan terus (Anti-Lag)
        if (!isProcessingHand) {
            isProcessingHand = true;
            // Kirim ke MediaPipe secara asinkron (tidak ditunggu/non-blocking)
            hands.send({ image: video }).then(() => {
                isProcessingHand = false;
            }).catch(() => {
                isProcessingHand = false;
            });
        }
    }
    
    // Jalankan fungsi render visual secara berkala mengikuti refresh rate monitor
    drawVisualsOnly();

    // PERFORMANCE COUNTER ENGINE
    frameCount++;
    const now = performance.now();
    globalTime = now * 0.002; 
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
        fpsCounter.innerText = `SYS_FPS: ${fps}`;
    }

    requestAnimationFrame(renderLoop);
}

// ===== ANTI-DELAY LERP =====
function adaptiveLerp(current, target) {
    const distance = Math.hypot(target.x - current.x, target.y - current.y);
    let lerpFactor = 0.35; 
    if (distance < 5) {
        lerpFactor = 0.12; 
    } else if (distance > 20) {
        lerpFactor = 0.75; 
    }
    current.x += (target.x - current.x) * lerpFactor;
    current.y += (target.y - current.y) * lerpFactor;
}

// 4. PIPELINE UPDATE DATA DARI MEDIAPIPE
let latestResults = null;
function onHandResults(results) {
    latestResults = results; // Hanya simpan data koordinat terbaru, render diurus oleh drawVisualsOnly
}

// 5. SEPARATE RENDERING PIPELINE (Fungsi Khusus Menggambar)
function drawVisualsOnly() {
    if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let leftHand = null;
    let rightHand = null;

    if (latestResults && latestResults.multiHandLandmarks && latestResults.multiHandedness) {
        latestResults.multiHandLandmarks.forEach((landmarks, index) => {
            const label = latestResults.multiHandedness[index].label; 
            
            // Gambar skeleton bawaan - Biru Neon Neon
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "rgba(0, 240, 255, 0.2)", lineWidth: 2 });
            drawLandmarks(ctx, landmarks, { color: "#00f0ff", fillColor: "#ffffff", radius: 2.5 });

            if (label === "Left") leftHand = landmarks;
            if (label === "Right") rightHand = landmarks;
        });
    }

    // MAPPING KOORDINAT KE HUD TARGET
    if (leftHand && rightHand) {
        hudFrame.isValid = true;
        hudFrame.topLeft.targetX     = leftHand[8].x * canvas.width;
        hudFrame.topLeft.targetY     = leftHand[8].y * canvas.height;
        hudFrame.bottomLeft.targetX  = leftHand[4].x * canvas.width;
        hudFrame.bottomLeft.targetY  = leftHand[4].y * canvas.height;
        hudFrame.topRight.targetX    = rightHand[8].x * canvas.width;
        hudFrame.topRight.targetY    = rightHand[8].y * canvas.height;
        hudFrame.bottomRight.targetX = rightHand[4].x * canvas.width;
        hudFrame.bottomRight.targetY = rightHand[4].y * canvas.height;
        
        hudFrame.opacity = Math.min(1, hudFrame.opacity + 0.2); 
    } else {
        hudFrame.isValid = false;
        hudFrame.opacity = Math.max(0, hudFrame.opacity - 0.15); 
    }

    // SMOOTHING LERP & BENTUK HUD UTAMA
    if (hudFrame.opacity > 0) {
        adaptiveLerp(hudFrame.topLeft, { x: hudFrame.topLeft.targetX, y: hudFrame.topLeft.targetY });
        adaptiveLerp(hudFrame.bottomLeft, { x: hudFrame.bottomLeft.targetX, y: hudFrame.bottomLeft.targetY });
        adaptiveLerp(hudFrame.topRight, { x: hudFrame.topRight.targetX, y: hudFrame.topRight.targetY });
        adaptiveLerp(hudFrame.bottomRight, { x: hudFrame.bottomRight.targetX, y: hudFrame.bottomRight.targetY });
        
        renderCyberHUDFrame();
    }

    renderWatermark();
}

// ===== ADVANCED CANVAS RENDERING API =====
function renderCyberHUDFrame() {
    ctx.save();
    ctx.globalAlpha = hudFrame.opacity;

    const pTL = hudFrame.topLeft;
    const pBL = hudFrame.bottomLeft;
    const pTR = hudFrame.topRight;
    const pBR = hudFrame.bottomRight;

    // --- FITUR A: LIGHTWEIGHT DYNAMIC PIXEL BLUR MASKING ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.clip(); 

    const pixelSize = 32; 
    offscreenCanvas.width = Math.max(1, canvas.width / pixelSize);
    offscreenCanvas.height = Math.max(1, canvas.height / pixelSize);
    
    offscreenCtx.imageSmoothingEnabled = false;
    offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = "rgba(0, 102, 255, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const scanlineY = (performance.now() * 0.08) % canvas.height;
    ctx.strokeStyle = "rgba(0, 240, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scanlineY);
    ctx.lineTo(canvas.width, scanlineY);
    ctx.stroke();
    ctx.restore();

    // --- FITUR B: DYNAMIC CONNECTING LINES ---
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 4;
    ctx.shadowColor = "#00f0ff";

    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.stroke();

    // --- FITUR C: HUD SIKU POINTER (BENTUK L) ---
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.shadowBlur = 4;
    ctx.shadowColor = "#00f0ff";
    
    const avgDist = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y) * 0.12;
    const len = Math.max(12, Math.min(28, avgDist)); 

    ctx.beginPath();
    ctx.moveTo(pTL.x + len, pTL.y); ctx.lineTo(pTL.x, pTL.y); ctx.lineTo(pTL.x, pTL.y + len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pTR.x - len, pTR.y); ctx.lineTo(pTR.x, pTR.y); ctx.lineTo(pTR.x, pTR.y + len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pBR.x - len, pBR.y); ctx.lineTo(pBR.x, pBR.y); ctx.lineTo(pBR.x, pBR.y - len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pBL.x + len, pBL.y); ctx.lineTo(pBL.x, pBL.y); ctx.lineTo(pBL.x, pBL.y - len);
    ctx.stroke();

    // Teks Indikator di atas Box 
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px monospace";
    
    ctx.save();
    ctx.translate(pTL.x, pTL.y - 8);
    ctx.scale(-1, 1); 
    ctx.fillText("AI_BLUE_BYPASS_MATRIX", -170, 0); 
    ctx.restore();

    ctx.restore();
}

// ===== FITUR D: DIGITAL CYBERPUNK WATERMARK SYSTEM =====
function renderWatermark() {
    ctx.save();
    const posX = canvas.width - 25;
    const posY = canvas.height - 25;

    ctx.font = "bold 16px 'Courier New', Courier, monospace";
    ctx.textAlign = "right";
    
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#ffffff";

    ctx.save();
    ctx.translate(posX, posY);
    ctx.scale(-1, 1);
    ctx.fillText("BY: RIZ_PROJECT", 0, 0);
    ctx.restore();

    ctx.restore();
}

// Jalankan inisialisasi sistem asinkron
initWebcam();
