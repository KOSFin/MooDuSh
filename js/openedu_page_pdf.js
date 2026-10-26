/* Package the original screenshot pixels as consecutive PDF pages, losslessly. */
(function (global) {
    async function create(canvas) {
        if (!global.PDFLib) throw new Error('PDF encoder is unavailable. Reload the extension and course tabs.');
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('The browser could not encode the full-page screenshot.');
        const pdf = await global.PDFLib.PDFDocument.create();
        const image = await pdf.embedPng(dataUrl);
        const width = canvas.width;
        const height = canvas.height;
        if (!(width > 0 && height > 0)) throw new Error('The full-page screenshot is empty.');
        // Keep a readable page aspect ratio. One shared lossless image is clipped
        // by each PDF page; no screenshot pixels are resampled or JPEG-encoded.
        const pixelsPerPage = Math.max(1, Math.floor(width * 1.4));
        const pointsPerPixel = Math.min(0.75, 14400 / Math.max(width, pixelsPerPage));
        for (let top = 0; top < height; top += pixelsPerPage) {
            const slice = Math.min(pixelsPerPage, height - top);
            const page = pdf.addPage();
            page.setSize(width * pointsPerPixel, slice * pointsPerPixel);
            page.drawImage(image, {
                x: 0, y: (slice + top - height) * pointsPerPixel,
                width: width * pointsPerPixel, height: height * pointsPerPixel
            });
        }
        pdf.setTitle('OpenEdu - full page');
        pdf.setSubject('Full-resolution course page screenshot');
        pdf.setProducer('MooDuSh');
        return {
            name: 'openedu-full-page.pdf', mimeType: 'application/pdf',
            dataUrl: await pdf.saveAsBase64({ dataUri: true })
        };
    }
    global.ParamExtOpeneduPagePdf = { create };
})(typeof window !== 'undefined' ? window : globalThis);
