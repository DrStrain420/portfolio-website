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

const compareSlider = document.getElementById('compare-slider');
const labelOriginal = document.getElementById('label-original');
const labelDithered = document.getElementById('label-dithered');

let originalImage = null;
let maxCanvasWidth = 1600; 
let isDragging = false;

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
        if (originalImage) requestAnimationFrame(processImage);
    });
});

downloadBtn.addEventListener('click', () => {
    if (!originalImage) return;
    const link = document.createElement('a');
    link.download = 'dithered-image.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
});

// --- Compare Slider Logic ---

function updateSliderPosition(e) {
    if (!isDragging) return;
    const rect = canvasContainer.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const percent = (x / rect.width) * 100;
    
    compareSlider.style.left = `${percent}%`;
    canvas.style.clipPath = `polygon(${percent}% 0, 100% 0, 100% 100%, ${percent}% 100%)`;
    
    if (percent < 15) {
        labelOriginal.classList.add('label-hidden');
    } else {
        labelOriginal.classList.remove('label-hidden');
    }
    if (percent > 85) {
        labelDithered.classList.add('label-hidden');
    } else {
        labelDithered.classList.remove('label-hidden');
    }
}

compareSlider.addEventListener('mousedown', (e) => {
    isDragging = true;
    compareSlider.classList.add('dragging');
    e.preventDefault(); // prevent text selection
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    compareSlider.classList.remove('dragging');
});

window.addEventListener('mousemove', updateSliderPosition);

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
            processImage();
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

function processImage() {
    if (!originalImage) return;

    let width = originalImage.width;
    let height = originalImage.height;
    if (width > maxCanvasWidth) {
        height = Math.floor(height * (maxCanvasWidth / width));
        width = maxCanvasWidth;
    }

    const resolution = parseInt(resolutionSlider.value);
    
    // Scale original canvas
    originalCanvas.width = width;
    originalCanvas.height = height;
    origCtx.drawImage(originalImage, 0, 0, width, height);

    // Calculate downscaled dimensions
    const downWidth = Math.max(1, Math.floor(width / resolution));
    const downHeight = Math.max(1, Math.floor(height / resolution));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = downWidth;
    offCanvas.height = downHeight;
    const offCtx = offCanvas.getContext('2d');
    
    offCtx.drawImage(originalImage, 0, 0, downWidth, downHeight);
    
    const imageData = offCtx.getImageData(0, 0, downWidth, downHeight);
    const data = imageData.data;
    
    const contrast = parseInt(contrastSlider.value);
    if (contrast !== 0) {
        applyContrast(data, contrast);
    }

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = data[i+1] = data[i+2] = gray;
    }

    const threshold = parseInt(thresholdSlider.value);
    
    for (let y = 0; y < downHeight; y++) {
        for (let x = 0; x < downWidth; x++) {
            const idx = (y * downWidth + x) * 4;
            const oldPixel = data[idx];
            const newPixel = oldPixel < threshold ? 0 : 255;
            
            data[idx] = newPixel;
            data[idx+1] = newPixel;
            data[idx+2] = newPixel;
            data[idx+3] = 255;
            
            const quantError = oldPixel - newPixel;
            
            if (x + 1 < downWidth) {
                data[idx + 4] += quantError * 7 / 16;
                data[idx + 5] += quantError * 7 / 16;
                data[idx + 6] += quantError * 7 / 16;
            }
            if (y + 1 < downHeight) {
                if (x - 1 >= 0) {
                    const blIdx = ((y + 1) * downWidth + (x - 1)) * 4;
                    data[blIdx] += quantError * 3 / 16;
                    data[blIdx + 1] += quantError * 3 / 16;
                    data[blIdx + 2] += quantError * 3 / 16;
                }
                const bIdx = ((y + 1) * downWidth + x) * 4;
                data[bIdx] += quantError * 5 / 16;
                data[bIdx + 1] += quantError * 5 / 16;
                data[bIdx + 2] += quantError * 5 / 16;
                
                if (x + 1 < downWidth) {
                    const brIdx = ((y + 1) * downWidth + (x + 1)) * 4;
                    data[brIdx] += quantError * 1 / 16;
                    data[brIdx + 1] += quantError * 1 / 16;
                    data[brIdx + 2] += quantError * 1 / 16;
                }
            }
        }
    }
    
    offCtx.putImageData(imageData, 0, 0);

    canvas.width = downWidth * resolution;
    canvas.height = downHeight * resolution;
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
}
