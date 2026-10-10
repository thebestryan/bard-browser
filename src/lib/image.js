/**
 * Uploaded images are shown as avatars and card covers. Storing a 6 MB phone
 * photo inline would bloat the app state that is re-saved on every edit, so
 * the entity gets a downscaled copy; the untouched original goes to User Files.
 */

/** Target long edge (px) per use — avatars are small, covers span a card. */
export const IMAGE_MAX = { avatar: 512, cover: 1280 };

/** Fit (w, h) inside a max long edge, never upscaling. Pure — tested. */
export function fitWithin(w, h, max) {
  if (!w || !h) return { w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    r.readAsDataURL(file);
  });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
    img.src = src;
  });

/**
 * Read an uploaded image file.
 * Returns { original, display } — `original` is the file's own data URL (for
 * User Files), `display` a downscaled JPEG for the entity. SVGs and GIFs are
 * kept as-is: rasterising would lose vectors / animation.
 */
export async function readImageFile(file, kind = "avatar") {
  if (!file?.type?.startsWith("image/")) throw new Error(`"${file?.name}" is not an image.`);
  const original = await readAsDataURL(file);
  if (/image\/(svg\+xml|gif)/.test(file.type)) return { original, display: original };

  const img = await loadImage(original);
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, IMAGE_MAX[kind] || IMAGE_MAX.avatar);
  if (w === img.naturalWidth && h === img.naturalHeight && file.size < 400_000) {
    return { original, display: original }; // already small enough
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return { original, display: canvas.toDataURL("image/jpeg", 0.86) };
}
