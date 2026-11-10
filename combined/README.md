# Master Tamas: combined UX + controls + enemy art preview (temporary)

Static phone-playtest build of branch `preview/ux-plus-controls` of
https://github.com/Storpappor/master-tamas-siege-of-sanshin, assembled from:

- the UX menu shell (PR #21) with the portrait title / Safari layout fix and the language rule (English menus and system UI, Swedish story, narration and character lines),
- mobile controls phase-1 revision 1d (PR #20 at `63721a63f2b0131f63152d49654d79c877765f9c`: stale-pointer and edge-reversal correction) plus the collapsible, corner-movable `?touchlog=1` diagnostic (`8c9318828abe41d985e5ad5b7ec1ac865691705f`),
- the approved boss (Råttfällan) and Thrower artwork (PR #23 at `eeae6c4667aae750708048c59c16cfbd053de741`, R1c hashes).

Source commit: `47d793c54cc3c21a265bc27c3f6df81ef6328f6b`

Default four-button layout (JUMP / PUNCH / KICK / THROW, tappable Kiai meter, drag past the ring to run);
no optional controls; the diagnostic appears only with ?touchlog=1. The root of this site is the comparison build (controls only, 9f37f68c945ef5f8200f91c6fc81040f996d9df7).
This is not the production game and will be deleted after the playtest.
