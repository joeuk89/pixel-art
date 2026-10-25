# Soundtrack

A Soundtrack is one music loop, Ambient loops at three Distances and up to two One-shots.

## Music

- Every Scene gets new music; music is never reused across Scenes. `service` is `stable-audio-3`; leave `file`, `loopStart`, `loopEnd` and `seam` for the music script. The script adds "instrumental, no vocals, no intro or outro, constant mood" to the brief itself.
- The brief names instruments, tempo and mood in a few plain words drawn from the Concept: "slow piano, rain on a window, warm and sparse".
- Ask for something sparse and calm enough to leave on for hours. No vocals, no drops, no build-ups.

## Distances

- **Near** only for a source visible on screen: rain on the window you can see, the kettle on the table.
- **Mid**: every Scene has one bed (room tone, traffic, a cafe murmur), plus at most one feature sound.
- **Far**: sounds of the setting beyond the frame: wind, distant traffic, the sea.
- **One-shots are far**: thunder, an owl, a bell. Give each an `every: [minSec, maxSec]` long enough that it stays a surprise, a minute or more.

At most 2 Ambient loops per Distance, 5 per Scene, and 2 One-shots per Scene.

## Gain

The Viewer plays each sound through its Distance's bus, set in `DISTANCE_BUSES` in `viewer/sound-schedule.ts`. The bus multiplies the entry's `gain`:

| Distance | Bus gain | Low-pass |
| --- | --- | --- |
| near | 0.7 | none |
| mid | 0.35 | 5,000 Hz |
| far | 0.15 | 1,200 Hz |

So a far sound at `gain` 1 plays at 0.15, under half as loud as a mid sound at the same `gain`. The low-pass also strips the hiss from wind and rain. A far sound that should be clearly heard, such as wind the Prompt names, needs a `gain` of about 2; `gain` has no upper limit. A mid feature sound that should stay in the background, such as a ticking clock, sits at about 0.25 against the bed's 1.

## Sources

Search the Sound library with `library-search <words> --sounds` and read the record of each candidate: its `distance` list says where it fits, and its `note` flags known problems. A curated entry is `{ "kind": "curated", "id": <record id> }` with a `file` name such as `rain.ogg`; licence and attribution stay in the record.

When nothing in the Sound library fits, plan a generated sound: `{ "kind": "generated", "service": "elevenlabs-fal", "brief": ... }`, a loop of up to 22 s. Describe the sound, not the Scene: "light rain on a window pane, steady, close".
