// Art pixels per game unit. The simulation stays at 320 x 180 game units; the renderer draws
// everything ART_SCALE times larger so sprites and backgrounds can carry 16-bit detail.
// Gameplay code never imports this: positions, speeds and hitboxes are all in game units.
export const ART_SCALE = 2;
