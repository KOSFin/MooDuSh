const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PDFLib = require('pdf-lib');
const context = { PDFLib };
vm.runInNewContext(fs.readFileSync(require.resolve('../js/openedu_page_pdf.js'), 'utf8'), context);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('the PDF preserves a shared lossless raster and covers the entire long page in order', async () => {
    const attachment = await context.ParamExtOpeneduPagePdf.create({ width: 1200, height: 3400, toDataURL: type => { assert.equal(type, 'image/png'); return png; } });
    assert.equal(attachment.name, 'openedu-full-page.pdf');
    assert.equal(attachment.mimeType, 'application/pdf');
    const pdf = await PDFLib.PDFDocument.load(attachment.dataUrl);
    assert.equal(pdf.getPageCount(), 3);
    assert.deepEqual(pdf.getPages().map(page => page.getSize()), [
        { width: 900, height: 1260 }, { width: 900, height: 1260 }, { width: 900, height: 30 }
    ]);
    const refs = pdf.getPages().map(page => {
        const xobjects = page.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
        return xobjects.entries()[0][1].toString();
    });
    assert.equal(new Set(refs).size, 1, 'each page clips the same embedded image instead of resampling it');
    const image = pdf.context.lookup(PDFLib.PDFRef.of(Number(refs[0].split(' ')[0])));
    assert.equal(image.dict.lookup(PDFLib.PDFName.of('Filter')).toString(), '/FlateDecode');
    assert.equal(image.dict.lookup(PDFLib.PDFName.of('Width')).asNumber(), 1);
    assert.equal(image.dict.lookup(PDFLib.PDFName.of('Height')).asNumber(), 1);
});

test('missing PDF encoder stops before sending the request', async () => {
    const isolated = {};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/openedu_page_pdf.js'), 'utf8'), isolated);
    await assert.rejects(isolated.ParamExtOpeneduPagePdf.create({}), /PDF encoder is unavailable/);
});
