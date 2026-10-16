// The man's right hand follows the visitor's mouse. The sprite sheet holds the
// arm region of a locked-off clip, from the mouse at its leftmost to its
// rightmost; we pick (and cross-fade) the frame matching the cursor's x.

export function createHand(meta, parent) {
  const { src, frames, fw, fh, x, y, scale } = meta;
  if (!frames) return { set() {}, release() {}, start() {}, stop() {}, el: null };
  const cv = document.createElement('canvas');
  cv.className = 'hand';
  cv.width = fw; cv.height = fh;
  Object.assign(cv.style, {
    left: x + 'px', top: y + 'px',
    width: fw * scale + 'px', height: fh * scale + 'px',
  });
  parent.appendChild(cv);
  const ctx = cv.getContext('2d');

  let sheet = null, target = 0.5, pos = 0.5, raf = 0, idle = true, lastMove = 0;

  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  img.decode().then(() => { sheet = img; draw(true); cv.classList.add('ready'); }).catch(() => {});

  function draw(force) {
    if (!sheet) return;
    const f = pos * (frames - 1);
    const i = Math.floor(f), t = f - i;
    ctx.globalAlpha = 1;
    ctx.drawImage(sheet, 0, i * fh, fw, fh, 0, 0, fw, fh);
    if (t > 0.02 && i + 1 < frames) {
      ctx.globalAlpha = t;
      ctx.drawImage(sheet, 0, (i + 1) * fh, fw, fh, 0, 0, fw, fh);
    }
  }

  function tick(now) {
    // With no mouse (touch, or a still cursor for a while) the hand drifts on its own.
    if (idle && now - lastMove > 2500) target = 0.5 + 0.32 * Math.sin(now / 2600) * Math.sin(now / 1700 + 1);
    const d = target - pos;
    if (Math.abs(d) > 0.001) { pos += d * 0.14; draw(); }
    raf = requestAnimationFrame(tick);
  }

  return {
    set(v) { target = Math.min(1, Math.max(0, v)); idle = false; lastMove = performance.now(); },
    release() { idle = true; },
    start() { if (!raf) raf = requestAnimationFrame(tick); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    el: cv,
  };
}
