const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const fpsCounter = document.getElementById("fps-counter");

// Canvas kecil untuk efek pixelate kilat tanpa membebani GPU
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

// ===== STATE SYSTEM & SMOOTHING CONFIGURATION =====
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
let globalTime = 0;
let isProcessingAI = false;

const hudFrame = {
    topLeft:     { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomLeft:  { x: 0, y: 0, targetX: 0, targetY: 0 },
    topRight:    { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomRight: { x: 0, y: 0, targetX: 0, targetY: 0 },
    opacity: 0, 
    isValid: false
};

// Inisialisasi MediaPipe Hands
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,          // OPTIMASI 1: Ubah ke 0 untuk performa super ringan & FPS tinggi tanpa mengurangi akurasi tracking utama
    minDetectionConfidence: 0.55, // Diturunkan sedikit agar respon deteksi tangan instan
    minTrackingConfidence: 0.55
});

hands.onResults(onHandResults);

// OPTIMASI 2: Kamera diatur ke resolusi seimbang (640x360) khusus saat dikirim ke AI
// Ini membuat proses komputasi model matematika 4x lipat jauh lebih ringan!
const camera = new Camera(video, {
    onFrame: async () => {
        if (!isProcessingAI && video.readyState >= 2) {
            isProcessingAI = true;
            await hands.send({ image: video });
            isProcessingAI = false;
        }
    },
    width: 640,
    height: 360
});
camera.start();

// ===== ULTRA RESPONSIF ANTI-DELAY LERP MATH =====
function adaptiveLerp(current, target) {
    const distance = Math.hypot(target.x - current.x, target.y - current.y);
    
    // Lerp adaptif yang agresif menghilangkan delay/efek tertinggal saat tangan bergerak cepat
    let lerpFactor = 0.35; 
    if (distance < 3) {
        lerpFactor = 0.12; 
    } else if (distance > 15) {
        lerpFactor = 0.70; // Langsung melesat menempel ujung jari jika gerakan mendadak cepat
    }
    
    current.x += (target.x - current.x) * lerpFactor;
    current.y += (target.y - current.y) * lerpFactor;
}

// ===== RENDER LOOP UTAMA (60 FPS SEAMLESS) =====
function processAnimation() {
    // Sinkronisasi resolusi internal kanvas mengikuti aspek rasio video asli
    if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Jalankan pergerakan animasi HUD yang super mulus konstan tanpa menunggu data dari AI
    if (hudFrame.opacity > 0) {
        adaptiveLerp(hudFrame.topLeft, { x: hudFrame.topLeft.targetX, y: hudFrame.topLeft.targetY });
        adaptiveLerp(hudFrame.bottomLeft, { x: hudFrame.bottomLeft.targetX, y: hudFrame.bottomLeft.targetY });
        adaptiveLerp(hudFrame.topRight, { x: hudFrame.topRight.targetX, y: hudFrame.topRight.targetY });
        adaptiveLerp(hudFrame.bottomRight, { x: hudFrame.bottomRight.targetX, y: hudFrame.bottomRight.targetY });
        
        renderCyberHUDFrame();
    }

    // Hitung performa FPS
    frameCount++;
    const now = performance.now();
    globalTime = now * 0.002;
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
        fpsCounter.innerText = `SYS_FPS: ${fps}`;
    }

    requestAnimationFrame(processAnimation);
}
// Jalankan siklus render loop independen 60 FPS
requestAnimationFrame(processAnimation);


// ===== PIPELINE DATA HAND TRACKING ASINKRON =====
function onHandResults(results) {
    let leftHand = null;
    let rightHand = null;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const label = results.multiHandedness[index].label; 
            
            // Gambar kerangka tangan bawaan (Dibuat minimalis agar tidak memakan memori render)
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "rgba(0, 255, 128, 0.25)", lineWidth: 2 });
            drawLandmarks(ctx, landmarks, { color: "#00ff80", fillColor: "#ffffff", radius: 3 });

            if (label === "Left") leftHand = landmarks;
            if (label === "Right") rightHand = landmarks;
        });
    }

    // MAPPING KOORDINAT BARU SECARA PROPORSIONAL
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
        
        hudFrame.opacity = Math.min(1, hudFrame.opacity + 0.15); 
    } else {
        hudFrame.isValid = false;
        hudFrame.opacity = Math.max(0, hudFrame.opacity - 0.15); 
    }
}

// ===== ADVANCED CANVAS RENDERING API =====
function renderCyberHUDFrame() {
    ctx.save();
    ctx.globalAlpha = hudFrame.opacity;

    const pTL = hudFrame.topLeft;
    const pBL = hudFrame.bottomLeft;
    const pTR = hudFrame.topRight;
    const pBR = hudFrame.bottomRight;

    // --- FITUR A: HIGH PERFORMANCE PIXEL BLUR MASKING (ZERO LAG) ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.clip(); 

    // OPTIMASI KUNCI: Canvas blur diperkecil menjadi bagi 40 untuk performa super enteng
    const pixelSize = 40; 
    offscreenCanvas.width = Math.max(1, canvas.width / pixelSize);
    offscreenCanvas.height = Math.max(1, canvas.height / pixelSize);
    
    offscreenCtx.imageSmoothingEnabled = false;
    offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);
    
    // Tint hijau cyber
    ctx.fillStyle = "rgba(0, 255, 128, 0.04)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const scanlineY = (performance.now() * 0.06) % canvas.height;
    ctx.strokeStyle = "rgba(0, 255, 128, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scanlineY);
    ctx.lineTo(canvas.width, scanlineY);
    ctx.stroke();
    ctx.restore();

    // --- FITUR B: DYNAMIC CONNECTING LINES ---
    const glowIntensity = 3 + Math.sin(globalTime * 4) * 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = glowIntensity;
    ctx.shadowColor = "#00ff80";

    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.stroke();

    // --- FITUR C: HUD CORNER CORNER STYLE (HURUF L DI UJUNG JARI) ---
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 5;
    ctx.shadowColor = "#00ff80";
    
    const avgDist = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y) * 0.12;
    const len = Math.max(10, Math.min(25, avgDist)); 

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

    // Teks Indikator di atas Box (Di-mirror balik agar tulisan tidak terbalik)
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px monospace";
    
    ctx.save();
    ctx.translate(pTL.x, pTL.y - 6);
    ctx.scale(-1, 1); 
    ctx.fillText("AI_STRETCH_MASK_MATRIX", -160, 0); 
    ctx.restore();

    ctx.restore();
}
