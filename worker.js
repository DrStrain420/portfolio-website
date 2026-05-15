self.onmessage = function(e) {
    const { imageData, threshold, contrast, shape } = e.data;
    
    // Convert to grayscale and apply contrast
    const data = new Uint8ClampedArray(imageData.data);
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

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = data[i+1] = data[i+2] = gray;
    }

    const bayer4x4 = [
        [ 0,  8,  2, 10],
        [12,  4, 14,  6],
        [ 3, 11,  1,  9],
        [15,  7, 13,  5]
    ];

    const cluster4x4 = [
        [12,  5,  6, 13],
        [ 4,  0,  1,  7],
        [11,  3,  2,  8],
        [15, 10,  9, 14]
    ];

    if (shape === 'diamond' || shape === 'circular') {
        const matrix = shape === 'diamond' ? bayer4x4 : cluster4x4;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const gray = data[idx];
                
                let adjustedGray = gray + (128 - threshold); 
                adjustedGray = Math.max(0, Math.min(255, adjustedGray));
                
                const mValue = matrix[y % 4][x % 4] / 16.0 * 255;
                const newPixel = adjustedGray > mValue ? 255 : 0;
                
                data[idx] = newPixel;
                data[idx+1] = newPixel;
                data[idx+2] = newPixel;
                data[idx+3] = 255;
            }
        }
    } else {
        // Floyd-Steinberg Error Diffusion
        const floatData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) floatData[i] = data[i];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const oldPixel = floatData[idx];
                const newPixel = oldPixel < threshold ? 0 : 255;
                
                data[idx] = newPixel;
                data[idx+1] = newPixel;
                data[idx+2] = newPixel;
                data[idx+3] = 255;
                
                const quantError = oldPixel - newPixel;
                
                if (x + 1 < width) {
                    floatData[idx + 4] += quantError * 7 / 16;
                }
                if (y + 1 < height) {
                    if (x - 1 >= 0) {
                        floatData[((y + 1) * width + (x - 1)) * 4] += quantError * 3 / 16;
                    }
                    floatData[((y + 1) * width + x) * 4] += quantError * 5 / 16;
                    if (x + 1 < width) {
                        floatData[((y + 1) * width + (x + 1)) * 4] += quantError * 1 / 16;
                    }
                }
            }
        }
    }

    self.postMessage({ processedData: new ImageData(data, width, height) });
};
