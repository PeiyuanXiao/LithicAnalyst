import iconCore from '../assets/brand/icon-core.svg?raw';
import iconFlake from '../assets/brand/icon-flake.svg?raw';
import iconGeneric from '../assets/brand/icon-generic.svg?raw';
import ghostCore from '../assets/brand/ghost-core.svg?raw';
import ghostFlake from '../assets/brand/ghost-flake.svg?raw';
import ghostGeneral from '../assets/brand/ghost-general.svg?raw';
import logo from '../assets/brand/logo.svg?raw';
import logoSmall from '../assets/brand/logo-small.svg?raw';
import wordmark from '../assets/brand/wordmark.svg?raw';

/** The brand's drawings, as text, inlined in the single file. */
export const BRAND = {
  logo,
  logoSmall,
  wordmark,
  icons: { core: iconCore, flake: iconFlake, generic: iconGeneric },
  ghosts: { core: ghostCore, flake: ghostFlake, generic: ghostGeneral },
};

/**
 * An SVG with its placeholder `LAID` (in its ids and their `url(#…)`) made `prefix`: ids are the document's, so two copies
 * of a gradient would clash, and one in a hidden element would leave the other with nothing to refer to.
 */
export function brandSvg(raw: string, prefix: string): string {
  return raw.split('LAID').join(prefix);
}

let copies = 0;

/** A prefix no other copy has. */
export const brandPrefix = (): string => `la${++copies}`;

/** Markup as an element. */
export function svgFrom(markup: string): SVGSVGElement {
  const box = document.createElement('template');
  box.innerHTML = markup.trim();
  return box.content.firstElementChild as SVGSVGElement;
}

/** A copy of a drawing, ready for the page. */
export function brandEl(raw: string, className?: string): SVGSVGElement {
  const svg = svgFrom(brandSvg(raw, brandPrefix()));
  if (className) svg.setAttribute('class', className);
  return svg;
}

/** What a drawing holds, without its own `<svg>`, to place inside another. */
export const brandInner = (raw: string, prefix: string): string =>
  brandSvg(raw, prefix)
    .trim()
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
