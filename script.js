const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const originalCanvas = document.getElementById('original-canvas');
const origCtx = originalCanvas.getContext('2d');
const downloadBtn = document.getElementById('download-btn');

const thresholdSlider = document.getElementById('threshold');
const thresholdVal = document.getElementById('threshold-val');
const contrastSlider = document.getElementById('contrast');
const contrastVal = document.getElementById('contrast-val');
const resolutionSlider = document.getElementById('resolution');
const resolutionVal = document.getElementById('resolution-val');

const btnOriginal = document.getElementById('btn-original');
const btnDithered = document.getElementById('btn-dithered');

let originalImage = null;
let maxPreviewWidth = 1600; // Cap for real-time responsiveness

// --- Event Listeners ---

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
    }
});

[thresholdSlider, contrastSlider, resolutionSlider].forEach(slider => {
    slider.addEventListener('input', (e) => {
        document.getElementById(`${e.target.id}-val`).textContent = e.target.value;
        if (originalImage) requestAnimationFrame(renderPreview);
    });
});

downloadBtn.addEventListener('click', () => {
    if (!originalImage) return;
    
    // UI Feedback
    downloadBtn.disabled = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'PROCESSING...';
    
    // Yield thread to allow DOM to update button text before heavy processing
    setTimeout(() => {
        exportHighRes();
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    }, 50);
});

// --- View Toggle Logic ---
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
            canvasContainer.style.display = 'block';
            downloadBtn.disabled = false;
            renderPreview();
            
            btnDithered.click();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function applyContrast(data, contrast) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
        data[i] = factor * (data[i] - 128) + 128;
        data[i+1] = factor * (data[i+1] - 128) + 128;
        data[i+2] = factor * (data[i+2] - 128) + 128;
    }
}

function processDither(imageData, threshold, contrast) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    if (contrast !== 0) {
        applyContrast(data, contrast);
    }

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = data[i+1] = data[i+2] = gray;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const oldPixel = data[idx];
            const newPixel = oldPixel < threshold ? 0 : 255;
            
            data[idx] = newPixel;
            data[idx+1] = newPixel;
            data[idx+2] = newPixel;
            data[idx+3] = 255;
            
            const quantError = oldPixel - newPixel;
            
            if (x + 1 < width) {
                data[idx + 4] += quantError * 7 / 16;
                data[idx + 5] += quantError * 7 / 16;
                data[idx + 6] += quantError * 7 / 16;
            }
            if (y + 1 < height) {
                if (x - 1 >= 0) {
                    const blIdx = ((y + 1) * width + (x - 1)) * 4;
                    data[blIdx] += quantError * 3 / 16;
                    data[blIdx + 1] += quantError * 3 / 16;
                    data[blIdx + 2] += quantError * 3 / 16;
                }
                const bIdx = ((y + 1) * width + x) * 4;
                data[bIdx] += quantError * 5 / 16;
                data[bIdx + 1] += quantError * 5 / 16;
                data[bIdx + 2] += quantError * 5 / 16;
                
                if (x + 1 < width) {
                    const brIdx = ((y + 1) * width + (x + 1)) * 4;
                    data[brIdx] += quantError * 1 / 16;
                    data[brIdx + 1] += quantError * 1 / 16;
                    data[brIdx + 2] += quantError * 1 / 16;
                }
            }
        }
    }
    return imageData;
}

function renderPreview() {
    if (!originalImage) return;

    // 1. Calculate the preview display size
    let previewWidth = originalImage.width;
    let previewHeight = originalImage.height;
    if (previewWidth > maxPreviewWidth) {
        previewHeight = Math.floor(previewHeight * (maxPreviewWidth / previewWidth));
        previewWidth = maxPreviewWidth;
    }

    // Set background original canvas
    originalCanvas.width = previewWidth;
    originalCanvas.height = previewHeight;
    origCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    // 2. Calculate the processing block dimensions based on ORIGINAL scale
    const resolution = parseInt(resolutionSlider.value);
    let processCols = Math.max(1, Math.floor(originalImage.width / resolution));
    let processRows = Math.max(1, Math.floor(originalImage.height / resolution));
    
    // For the preview, cap the processing columns to prevent UI lag on massive images
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
    
    // Run the actual Dither math
    const processedData = processDither(imageData, threshold, contrast);
    offCtx.putImageData(processedData, 0, 0);

    // 3. Upscale sharply to the preview display size
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, previewWidth, previewHeight);
}

function exportHighRes() {
    if (!originalImage) return;

    const resolution = parseInt(resolutionSlider.value);
    const contrast = parseInt(contrastSlider.value);
    const threshold = parseInt(thresholdSlider.value);

    // 1. Exact mathematical block dimensions relative to the original image size
    const processCols = Math.max(1, Math.floor(originalImage.width / resolution));
    const processRows = Math.max(1, Math.floor(originalImage.height / resolution));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = processCols;
    offCanvas.height = processRows;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(originalImage, 0, 0, processCols, processRows);

    const imageData = offCtx.getImageData(0, 0, processCols, processRows);
    
    // 2. Process full scale array
    const processedData = processDither(imageData, threshold, contrast);
    offCtx.putImageData(processedData, 0, 0);

    // 3. Create final exact-dimension export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = originalImage.width;
    exportCanvas.height = originalImage.height;
    const exportCtx = exportCanvas.getContext('2d');
    
    exportCtx.imageSmoothingEnabled = false;
    exportCtx.drawImage(offCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
    
    // 4. Trigger download
    exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'dithered-highres.png';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}
