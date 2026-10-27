// Shrink a phone photo BEFORE it is stored or sent: longest side 1024 px, JPEG 70%
// (a 3–6 MB camera photo becomes roughly 100–200 KB; barcodes and plates stay readable).
export async function compressImage(file, max = 1024, quality = 0.7) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const k = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality))
  } finally { URL.revokeObjectURL(url) }
}

// Best-effort phone GPS (does not block the user; resolves null if refused / unavailable)
export function getGps(timeout = 8000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null)
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
      () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 })
  })
}
