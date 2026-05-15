const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const originalCanvas = document.getElementById('original-canvas');
const origCtx = originalCanvas.getContext('2d');
const downloadBtn = document.getElementById('download-btn');

const thresholdSlider = document.getElementById('threshold');
const contrastSlider = document.getElementById('contrast');
const resolutionSlider = document.getElementById('resolution');
const blurSlider = document.getElementById('blur');
const glowSlider = document.getElementById('glow');
const tonalSlider = document.getElementById('tonal');
const shapeInput = document.getElementById('shape');

const btnOriginal = document.getElementById('btn-original');
const btnDithered = document.getElementById('btn-dithered');

let originalImage = null;
let maxPreviewWidth = 1600;

const ditherWorker = new Worker('worker.js');

// --- Global Drag Feedback ---
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('global-drag-active');
});

window.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter === 0) {
        document.body.classList.remove('global-drag-active');
    }
});

window.addEventListener('dragover', (e) => { e.preventDefault(); });

window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('global-drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
    }
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
    }
});

// --- Sliders ---
[thresholdSlider, contrastSlider, resolutionSlider, blurSlider, glowSlider, tonalSlider].forEach(slider => {
    slider.addEventListener('input', (e) => {
        document.getElementById(`${e.target.id}-val`).textContent = e.target.value;
        if (originalImage) requestAnimationFrame(processImage);
    });
});

// --- Export Logic ---
downloadBtn.addEventListener('click', () => {
    if (!originalImage) return;
    
    downloadBtn.disabled = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'PROCESSING...';
    
    exportHighRes((url) => {
        const link = document.createElement('a');
        link.download = 'ditherer-export.png';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    });
});

// --- View Toggle ---
btnOriginal.addEventListener('click', () => {
    btnOriginal.classList.add('active');
    btnDithered.classList.remove('active');
    canvas.style.display = 'none';
});

btnDithered.addEventListener('click', () => {
    btnDithered.classList.add('active');
    btnOriginal.classList.remove('active');
    canvas.style.display = 'block';
});

// --- Reset ---
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        thresholdSlider.value = 128; document.getElementById('threshold-val').textContent = '128';
        contrastSlider.value = 0; document.getElementById('contrast-val').textContent = '0';
        resolutionSlider.value = 1; document.getElementById('resolution-val').textContent = '1';
        tonalSlider.value = 0; document.getElementById('tonal-val').textContent = '0';
        blurSlider.value = 0; document.getElementById('blur-val').textContent = '0';
        glowSlider.value = 0; document.getElementById('glow-val').textContent = '0';
        shapeInput.value = 'default';
        if (originalImage) processImage();
    });
}

// --- Core Logic ---

function handleFile(file) {
    if (!file.type.match('image.*')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            canvasContainer.style.display = 'flex';
            downloadBtn.disabled = false;
            processImage();
            btnDithered.click();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function processDitherSync(imageData, threshold, contrast, shape, tonal) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    if (contrast !== 0) {
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        for (let i = 0; i < data.length; i += 4) {
            data[i] = factor * (data[i] - 128) + 128;
            data[i+1] = factor * (data[i+1] - 128) + 128;
            data[i+2] = factor * (data[i+2] - 128) + 128;
        }
    }

    const gamma = tonal ? Math.pow(2, -tonal / 50.0) : 1;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        if (tonal !== 0) {
            let normalized = gray / 255.0;
            gray = Math.pow(normalized, gamma) * 255;
        }
        data[i] = data[i+1] = data[i+2] = gray;
    }

    const bayer4x4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    const cluster4x4 = [[12,5,6,13],[4,0,1,7],[11,3,2,8],[15,10,9,14]];

    if (shape === 'diamond' || shape === 'circular') {
        const matrix = shape === 'diamond' ? bayer4x4 : cluster4x4;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                let adjustedGray = data[idx] + (128 - threshold); 
                adjustedGray = Math.max(0, Math.min(255, adjustedGray));
                const mValue = matrix[y % 4][x % 4] / 16.0 * 255;
                const newPixel = adjustedGray > mValue ? 255 : 0;
                data[idx] = data[idx+1] = data[idx+2] = newPixel;
                data[idx+3] = 255;
            }
        }
    } else {
        const floatData = new Float32Array(data);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const oldPixel = floatData[idx];
                const newPixel = oldPixel < threshold ? 0 : 255;
                data[idx] = data[idx+1] = data[idx+2] = newPixel;
                data[idx+3] = 255;
                const quantError = oldPixel - newPixel;
                if (x + 1 < width) floatData[idx + 4] += quantError * 7 / 16;
                if (y + 1 < height) {
                    if (x - 1 >= 0) floatData[((y + 1) * width + (x - 1)) * 4] += quantError * 3 / 16;
                    floatData[((y + 1) * width + x) * 4] += quantError * 5 / 16;
                    if (x + 1 < width) floatData[((y + 1) * width + (x + 1)) * 4] += quantError * 1 / 16;
                }
            }
        }
    }
    return imageData;
}

function processImage() {
    if (!originalImage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    origCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);

    let previewWidth = originalImage.width;
    let previewHeight = originalImage.height;
    if (previewWidth > maxPreviewWidth) {
        previewHeight = Math.floor(previewHeight * (maxPreviewWidth / previewWidth));
        previewWidth = maxPreviewWidth;
    }

    originalCanvas.width = previewWidth;
    originalCanvas.height = previewHeight;
    origCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    const resolution = parseInt(resolutionSlider.value);
    let processCols = Math.max(1, Math.floor(originalImage.width / resolution));
    let processRows = Math.max(1, Math.floor(originalImage.height / resolution));
    
    if (processCols > maxPreviewWidth) {
        const scale = maxPreviewWidth / processCols;
        processCols = maxPreviewWidth;
        processRows = Math.max(1, Math.floor(processRows * scale));
    }

    const offCanvas = document.createElement('canvas');
    offCanvas.width = processCols;
    offCanvas.height = processRows;
    const offCtx = offCanvas.getContext('2d');
    
    offCtx.clearRect(0, 0, processCols, processRows);
    
    // 1. Pre-Dither Blur
    const blurAmount = parseInt(blurSlider.value);
    if (blurAmount > 0) {
        offCtx.filter = `blur(${blurAmount}px)`;
    }
    offCtx.drawImage(originalImage, 0, 0, processCols, processRows);
    offCtx.filter = 'none'; // reset filter
    
    const imageData = offCtx.getImageData(0, 0, processCols, processRows);
    
    const contrast = parseInt(contrastSlider.value);
    const threshold = parseInt(thresholdSlider.value);
    const tonal = parseInt(tonalSlider.value);
    const shape = shapeInput.value;
    
    // 2. Process Dither Math
    const processedData = processDitherSync(imageData, threshold, contrast, shape, tonal);
    offCtx.putImageData(processedData, 0, 0);

    // 3. Post-Dither Glow (Bloom)
    const glowAmount = parseInt(glowSlider.value);
    if (glowAmount > 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = processCols;
        tempCanvas.height = processRows;
        tempCanvas.getContext('2d').putImageData(processedData, 0, 0);
        
        offCtx.globalCompositeOperation = 'screen';
        offCtx.filter = `blur(${glowAmount}px)`;
        offCtx.drawImage(tempCanvas, 0, 0);
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.filter = 'none';
    }

    canvas.width = previewWidth;
    canvas.height = previewHeight;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, previewWidth, previewHeight);
}

function exportHighRes(callback) {
    const resolution = parseInt(resolutionSlider.value);
    const blurAmount = parseInt(blurSlider.value);
    const glowAmount = parseInt(glowSlider.value);
    
    const processCols = Math.max(1, Math.floor(originalImage.width / resolution));
    const processRows = Math.max(1, Math.floor(originalImage.height / resolution));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = processCols;
    offCanvas.height = processRows;
    const offCtx = offCanvas.getContext('2d');
    
    if (blurAmount > 0) {
        offCtx.filter = `blur(${blurAmount}px)`;
    }
    offCtx.drawImage(originalImage, 0, 0, processCols, processRows);
    offCtx.filter = 'none';

    const imageData = offCtx.getImageData(0, 0, processCols, processRows);
    
    ditherWorker.onmessage = function(e) {
        const processedData = e.data.processedData;
        offCtx.putImageData(processedData, 0, 0);
        
        if (glowAmount > 0) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = processCols;
            tempCanvas.height = processRows;
            tempCanvas.getContext('2d').putImageData(processedData, 0, 0);
            
            offCtx.globalCompositeOperation = 'screen';
            offCtx.filter = `blur(${glowAmount}px)`;
            offCtx.drawImage(tempCanvas, 0, 0);
            offCtx.globalCompositeOperation = 'source-over';
            offCtx.filter = 'none';
        }
        
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = originalImage.width;
        exportCanvas.height = originalImage.height;
        const exportCtx = exportCanvas.getContext('2d');
        exportCtx.imageSmoothingEnabled = false;
        exportCtx.drawImage(offCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
        
        exportCanvas.toBlob((blob) => {
            callback(URL.createObjectURL(blob));
        }, 'image/png');
    };

    ditherWorker.postMessage({
        imageData: imageData,
        threshold: parseInt(thresholdSlider.value),
        contrast: parseInt(contrastSlider.value),
        tonal: parseInt(tonalSlider.value),
        shape: shapeInput.value
    });
}
