// Barcode/QR reader for phones without a built-in reader (iPhone Safari, some Android browsers):
// zxing-cpp compiled to WebAssembly. Much stronger than the old JavaScript ZXing on small or slightly
// tilted 1D plates (tested on a real RTMA plate: Code 128 "6068203" read; the old reader could not).
// The .wasm file (~0.9 MB) is served from our own site and kept on the phone by the service worker.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

let ready
export function loadReader() {
  if (!ready) {
    prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } })
    ready = Promise.resolve()
  }
  return ready
}

const FORMATS = ['QRCode', 'Code128', 'Code39', 'Code93', 'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'ITF', 'Codabar', 'DataMatrix']

// Read one code from an ImageData (already cropped to the scan frame)
export async function readFrame(imageData) {
  await loadReader()
  const res = await readBarcodes(imageData, { tryHarder: true, tryRotate: true, formats: FORMATS, maxNumberOfSymbols: 1 })
  return res.find(r => r.isValid && r.text)?.text || null
}
