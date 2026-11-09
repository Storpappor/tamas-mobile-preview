// Hand-drawn zone backgrounds: one opaque PNG per zone, drawn 1:1 into the pre-rendered world.
// A zone without a valid image keeps its procedural painter, so a missing or broken file never
// changes what the game does; it only changes what the room looks like.
import { VIEW_H } from './constants.js';
import { ART_SCALE } from './artScale.js';

export const BACKGROUNDS = {
  street: '../assets/backgrounds/street.png',
  dojo: '../assets/backgrounds/dojo.png',
};

export function loadBackground(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load background: ${url}`));
    img.src = url;
  });
}

// A background fits a zone only at the zone's exact art size: (to - from) x VIEW_H game units at
// ART_SCALE. For the street (0..1000) that is 2000 x 360 and for the dojo (1000..1920) 1840 x 360.
// Anything else is refused with a reason.
export function validateBackground(img, zone) {
  const w = img ? (img.naturalWidth ?? img.width) : undefined;
  const h = img ? (img.naturalHeight ?? img.height) : undefined;
  const needW = (zone.to - zone.from) * ART_SCALE, needH = VIEW_H * ART_SCALE;
  if (!img) return `no background image for "${zone.art}"`;
  if (w !== needW || h !== needH) return `background for "${zone.art}" is ${w}x${h}, expected ${needW}x${needH}`;
  return null;
}
