const MB = 1024 * 1024;
const RAW_LIMIT_MB = 25;
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const STANDARD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSION_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', hif: 'image/heif',
};

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const IMAGE_ACCEPT_WITH_GIF = `${IMAGE_ACCEPT},image/gif,.gif`;
export const DOCUMENT_ACCEPT = `.pdf,application/pdf,${IMAGE_ACCEPT}`;

const extensionOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** The file's real type; iPhones/Windows sometimes leave `type` empty, so fall back to the extension. */
export function resolveType(file) {
  const type = (file?.type || '').toLowerCase();
  if (type && type !== 'application/octet-stream') return type;
  return EXTENSION_TYPES[extensionOf(file?.name)] || type;
}

export const isHeic = (file) => HEIC_TYPES.has(resolveType(file));

export function describeImageProblem(file, { allowGif = false, rawLimitMb = RAW_LIMIT_MB } = {}) {
  const type = resolveType(file);
  const supported = STANDARD_TYPES.has(type) || HEIC_TYPES.has(type) || (allowGif && type === 'image/gif');
  if (!supported) {
    return `is not a supported image. Use ${allowGif ? 'JPG, PNG, WebP, GIF' : 'JPG, PNG, WebP'} or iPhone HEIC photos.`;
  }
  if (file.size > rawLimitMb * MB) return `is too large (${(file.size / MB).toFixed(1)} MB). Choose a photo under ${rawLimitMb} MB.`;
  if (file.size === 0) return 'is empty. Choose a different file.';
  return '';
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> decoding */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Converts iPhone HEIC photos to JPEG (where the browser can decode them) and shrinks large photos so
 * uploads stay small and fast. If the browser cannot decode the file, it is returned unchanged
 * and the server converts HEIC itself.
 */
export async function prepareImage(file, { maxDimension = 1600, quality = 0.82, shrinkAboveBytes = 600 * 1024 } = {}) {
  const type = resolveType(file);
  if (type === 'image/gif') return file;
  const heic = HEIC_TYPES.has(type);
  if (!heic && file.size <= shrinkAboveBytes) return file;

  try {
    const bitmap = await decode(file);
    const width = bitmap.width || bitmap.naturalWidth;
    const height = bitmap.height || bitmap.naturalHeight;
    if (!width || !height) return file;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || (!heic && blob.size >= file.size)) return file;
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Validates and prepares a PDF or image document. Resolves to `{ file }` or `{ error }`. */
export async function prepareDocument(file, { maxMb = 5 } = {}) {
  if (!file) return { file: null };
  const type = resolveType(file);
  if (type === 'application/pdf' || extensionOf(file.name) === 'pdf') {
    if (file.size > maxMb * MB) return { error: `"${file.name}" is ${(file.size / MB).toFixed(1)} MB. PDFs must be ${maxMb} MB or smaller.` };
    return { file };
  }
  const problem = describeImageProblem(file);
  if (problem.includes('not a supported image')) return { error: `"${file.name}" is not a supported document. Upload a PDF, PNG, JPEG, WebP or iPhone HEIC photo.` };
  if (problem) return { error: `"${file.name}" ${problem}` };
  const prepared = await prepareImage(file, { maxDimension: 2400, quality: 0.85, shrinkAboveBytes: 1.5 * MB });
  if (prepared.size > maxMb * MB) return { error: `"${file.name}" is still ${(prepared.size / MB).toFixed(1)} MB after compressing. Maximum is ${maxMb} MB.` };
  return { file: prepared };
}
