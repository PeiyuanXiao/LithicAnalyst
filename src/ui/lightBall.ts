import { DEFAULT_LIGHT, discFromLight, lightFromDisc } from '../render/lighting';
import { t } from './i18n';
import { tips } from './tooltip';

/** Its size on the page (CSS pixels). */
const SIZE = 64;
/** A step of the arrow keys (degrees). */
const KEY_STEP = 5;

export interface LightBall {
  el: HTMLCanvasElement;
  /** Show this light (it was changed elsewhere, or the theme was). */
  set(azimuthDeg: number, elevationDeg: number): void;
}

/**
 * A small lit sphere for setting the light: the point under the cursor is where
 * the light comes from, by the same rule as the view under the L key
 * (lightFromDisc), so the centre is the light from the viewer and the rim raking
 * light. A click jumps there, a drag follows, a double click goes back to the
 * default; the arrow keys nudge it when it has the focus. Drawn on a 2D canvas,
 * only when the light changes.
 */
export function lightBall(azimuthDeg: number, elevationDeg: number, onInput: (azimuthDeg: number, elevationDeg: number) => void): LightBall {
  const el = document.createElement('canvas');
  el.id = 'light-ball';
  el.className = 'light-ball';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', t('display.light'));
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(SIZE * scale);
  el.width = el.height = px;
  el.style.width = el.style.height = `${SIZE}px`;
  let az = azimuthDeg, elev = elevationDeg;

  const value = () => t('display.lightValue', { az: Math.round(az), el: Math.round(elev) });

  const draw = () => {
    el.setAttribute('aria-valuetext', value());
    const g = el.getContext('2d');
    if (!g) return;
    const a = (az * Math.PI) / 180, b = (elev * Math.PI) / 180;
    const lx = Math.cos(b) * Math.cos(a), ly = Math.cos(b) * Math.sin(a), lz = Math.sin(b);
    const image = g.createImageData(px, px);
    const radius = px / 2 - scale;
    for (let j = 0; j < px; j++)
      for (let i = 0; i < px; i++) {
        const x = (i + 0.5 - px / 2) / radius, y = -(j + 0.5 - px / 2) / radius;
        const rr = x * x + y * y;
        const edge = (1 - Math.sqrt(rr)) * radius + 0.5;
        if (edge <= 0) continue;
        const z = Math.sqrt(Math.max(0, 1 - rr));
        const lit = Math.max(0, x * lx + y * ly + z * lz);
        const shade = 0.22 + 0.72 * lit;
        const k = 4 * (j * px + i);
        image.data[k] = 255 * shade;
        image.data[k + 1] = 255 * shade * 0.985;
        image.data[k + 2] = 255 * shade * 0.95;
        image.data[k + 3] = 255 * Math.min(1, edge);
      }
    g.putImageData(image, 0, 0);
    // where the light is
    const spot = discFromLight(az, elev);
    g.beginPath();
    g.arc(px / 2 + spot.x * radius, px / 2 - spot.y * radius, 3.5 * scale, 0, 2 * Math.PI);
    g.fillStyle = getComputedStyle(el).getPropertyValue('--accent-line').trim() || '#a8670f';
    g.fill();
    g.lineWidth = scale;
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.stroke();
  };

  const change = (azimuth: number, elevation: number) => {
    az = azimuth;
    elev = elevation;
    draw();
    onInput(az, elev);
  };

  const fromPointer = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const light = lightFromDisc((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -(e.clientY - (r.top + r.height / 2)) / (r.height / 2));
    change(Math.round(light.azimuthDeg), Math.round(light.elevationDeg));
    tips.showAt(e.clientX, e.clientY, { label: value() });
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    fromPointer(e);
    e.preventDefault();
    el.focus({ preventScroll: true });
  });
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  const release = () => tips.hideAt();
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('dblclick', () => change(DEFAULT_LIGHT.azimuthDeg, DEFAULT_LIGHT.elevationDeg));
  el.addEventListener('keydown', (e) => {
    const turn = e.key === 'ArrowLeft' ? KEY_STEP : e.key === 'ArrowRight' ? -KEY_STEP : 0;
    const raise = e.key === 'ArrowUp' ? KEY_STEP : e.key === 'ArrowDown' ? -KEY_STEP : 0;
    if (!turn && !raise) return;
    e.preventDefault();
    e.stopPropagation();
    change((az + turn + 360) % 360, Math.max(5, Math.min(90, elev + raise)));
  });
  tips.attach(el, () => ({ label: value() }));
  draw();

  return {
    el,
    set(azimuth, elevation) {
      az = azimuth;
      elev = elevation;
      draw();
    },
  };
}
