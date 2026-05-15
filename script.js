const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const placeholderText = document.getElementById('placeholder-text');
const downloadBtn = document.getElementById('download-btn');

const thresholdSlider = document.getElementById('threshold');
const thresholdVal = document.getElementById('threshold-val');
const contrastSlider = document.getElementById('contrast');
const contrastVal = document.getElementById('contrast-val');

let originalImage = null;
let maxCanvasWidth = 1200; // Limit processing size for performance

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

thresholdSlider.addEventListener('input', (e) => {
    thresholdVal.textContent = e.target.value;
    if (originalImage) requestAnimationFrame(processImage);
});

contrastSlider.addEventListener('input', (e) => {
    contrastVal.textContent = e.target.value;
    if (originalImage) requestAnimationFrame(processImage);
});

downloadBtn.addEventListener('click', () => {
    if (!originalImage) return;
    const link = document.createElement('a');
    link.download = 'dithered-image.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
});

// --- Core Logic ---

function handleFile(file) {
    if (!file.type.match('image.*')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            placeholderText.style.display = 'none';
            canvas.style.display = 'block';
            downloadBtn.disabled = false;
            
            // Resize logic to avoid hanging the browser on huge images
            let width = img.width;
            let height = img.height;
            if (width > maxCanvasWidth) {
                height = Math.floor(height * (maxCanvasWidth / width));
                width = maxCanvasWidth;
            }
            canvas.width = width;
            canvas.height = height;

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

    const width = canvas.width;
    const height = canvas.height;
    
    // Draw original image
    ctx.drawImage(originalImage, 0, 0, width, height);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // 1. Grayscale & Contrast
    const contrast = parseInt(contrastSlider.value);
    if (contrast !== 0) {
        applyContrast(data, contrast);
    }

    // Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
        // Luminance
        const r = data[i], g = data[i+1], b = data[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = data[i+1] = data[i+2] = gray;
    }

    // 2. Floyd-Steinberg Dithering
    const threshold = parseInt(thresholdSlider.value);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const oldPixel = data[idx];
            const newPixel = oldPixel < threshold ? 0 : 255;
            
            data[idx] = newPixel;
            data[idx+1] = newPixel;
            data[idx+2] = newPixel;
            
            const quantError = oldPixel - newPixel;
            
            // Distribute error
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
    
    ctx.putImageData(imageData, 0, 0);
}
