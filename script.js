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
const shapeInput = document.getElementById('shape');

const btnOriginal = document.getElementById('btn-original');
const btnDithered = document.getElementById('btn-dithered');

const presetNewsy = document.getElementById('preset-newsy');
const presetGlitch = document.getElementById('preset-glitch');
const preset1bit = document.getElementById('preset-1bit');

let originalImage = null;
let maxPreviewWidth = 1600;

// Setup Worker
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

window.addEventListener('dragover', (e) => {
    e.preventDefault();
});

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
[thresholdSlider, contrastSlider, resolutionSlider].forEach(slider => {
    slider.addEventListener('input', (e) => {
        document.getElementById(`${e.target.id}-val`).textContent = e.target.value;
        if (originalImage) requestAnimationFrame(renderPreview);
    });
});

// --- Presets ---
function applyPreset(threshold, contrast, resolution, shape) {
    thresholdSlider.value = threshold;
    document.getElementById('threshold-val').textContent = threshold;
    
    contrastSlider.value = contrast;
    document.getElementById('contrast-val').textContent = contrast;
    
    resolutionSlider.value = resolution;
    document.getElementById('resolution-val').textContent = resolution;
    
    shapeInput.value = shape;
    
    if (originalImage) renderPreview();
}

presetNewsy.addEventListener('click', () => applyPreset(160, -20, 8, 'circular'));
presetGlitch.addEventListener('click', () => applyPreset(90, 80, 16, 'diamond'));
preset1bit.addEventListener('click', () => applyPreset(128, 0, 4, 'default'));

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
    canvas.style.opacity = '0';
});

btnDithered.addEventListener('click', () => {
    btnDithered.classList.add('active');
    btnOriginal.classList.remove('active');
    canvas.style.opacity = '1';
});

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
            renderPreview();
            btnDithered.click();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Since preview needs to be fast, we duplicate the worker logic synchronously for the small canvas
// to avoid async jitter on the sliders.
function applyContrastSync(data, contrast) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
        data[i] = factor * (data[i] - 128) + 128;
        data[i+1] = factor * (data[i+1] - 128) + 128;
        data[i+2] = factor * (data[i+2] - 128) + 128;
    }
}

function processDitherSync(imageData, threshold, contrast, shape) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    if (contrast !== 0) applyContrastSync(data, contrast);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
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

function renderPreview() {
    if (!originalImage) return;

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
    offCtx.drawImage(originalImage, 0, 0, processCols, processRows);
    
    const imageData = offCtx.getImageData(0, 0, processCols, processRows);
    const contrast = parseInt(contrastSlider.value);
    const threshold = parseInt(thresholdSlider.value);
    const shape = shapeInput.value;
    
    const processedData = processDitherSync(imageData, threshold, contrast, shape);
    offCtx.putImageData(processedData, 0, 0);

    canvas.width = previewWidth;
    canvas.height = previewHeight;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, previewWidth, previewHeight);
}

function exportHighRes(callback) {
    const resolution = parseInt(resolutionSlider.value);
    const processCols = Math.max(1, Math.floor(originalImage.width / resolution));
    const processRows = Math.max(1, Math.floor(originalImage.height / resolution));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = processCols;
    offCanvas.height = processRows;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(originalImage, 0, 0, processCols, processRows);

    const imageData = offCtx.getImageData(0, 0, processCols, processRows);
    
    // Offload to Web Worker
    ditherWorker.onmessage = function(e) {
        const processedData = e.data.processedData;
        offCtx.putImageData(processedData, 0, 0);
        
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
        shape: shapeInput.value
    });
}
