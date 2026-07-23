import { describe, it, expect, beforeEach } from "vitest";
import type { Clip } from "@mvs/shared";
import { useStore, MIN_CLIP_LEN, MAX_CLIP_LEN } from "./store.js";

function makeClip(over: Partial<Clip> & { id: string; start: number; end: number }): Clip {
  return {
    source: "continue",
    status: "empty",
    ...over,
  };
}

describe("moveBoundary", () => {
  beforeEach(() => {
    useStore.setState({ clips: [], selectedClipId: null });
  });

  it("moves the boundary between two empty clips", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.end).toBe(7);
    expect(b!.start).toBe(7);
  });

  it("clamps so neither side shrinks below MIN_CLIP_LEN", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    // newTime way past the right end — should clamp so right stays >= MIN_CLIP_LEN long
    useStore.getState().moveBoundary("b", 99);
    const [a, b] = useStore.getState().clips;
    expect(b!.end - b!.start).toBeGreaterThanOrEqual(MIN_CLIP_LEN);
    expect(a!.end).toBeLessThanOrEqual(10 - MIN_CLIP_LEN);
  });

  it("clamps so neither side grows past MAX_CLIP_LEN", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 30 }),
      ],
    });
    // newTime would make right side 1s long (29s long left) — left can't
    // exceed MAX_CLIP_LEN, so the move should be capped.
    useStore.getState().moveBoundary("b", 29);
    const [a] = useStore.getState().clips;
    expect(a!.end - a!.start).toBeLessThanOrEqual(MAX_CLIP_LEN);
  });

  it("preserves videoUrl on non-lipSync clips (renderer + preview time-stretch)", () => {
    useStore.setState({
      clips: [
        makeClip({
          id: "a",
          start: 0,
          end: 5,
          status: "ready",
          source: "continue",
          videoUrl: "https://example.com/a.mp4",
        }),
        makeClip({
          id: "b",
          start: 5,
          end: 10,
          status: "ready",
          source: "continue",
          videoUrl: "https://example.com/b.mp4",
        }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.videoUrl).toBe("https://example.com/a.mp4");
    expect(a!.status).toBe("ready");
    expect(b!.videoUrl).toBe("https://example.com/b.mp4");
    expect(b!.status).toBe("ready");
  });

  it("preserves the LEFT lipSync videoUrl when its end shrinks (new slot is a prefix)", () => {
    useStore.setState({
      clips: [
        makeClip({
          id: "a",
          start: 0,
          end: 5,
          status: "ready",
          source: "lipSync",
          videoUrl: "https://example.com/lip-a.mp4",
        }),
        makeClip({
          id: "b",
          start: 5,
          end: 10,
          status: "ready",
          source: "continue",
          videoUrl: "https://example.com/b.mp4",
        }),
      ],
    });
    // shrink left: 5 → 3
    useStore.getState().moveBoundary("b", 3);
    const [a] = useStore.getState().clips;
    expect(a!.videoUrl).toBe("https://example.com/lip-a.mp4");
    expect(a!.status).toBe("ready");
  });

  it("wipes the LEFT lipSync videoUrl when its end GROWS (new slot extends past the gen)", () => {
    useStore.setState({
      clips: [
        makeClip({
          id: "a",
          start: 0,
          end: 5,
          status: "ready",
          source: "lipSync",
          videoUrl: "https://example.com/lip-a.mp4",
        }),
        makeClip({ id: "b", start: 5, end: 12 }),
      ],
    });
    // grow left: 5 → 7
    useStore.getState().moveBoundary("b", 7);
    const [a] = useStore.getState().clips;
    expect(a!.videoUrl).toBeUndefined();
    expect(a!.status).toBe("empty");
  });

  it("wipes the RIGHT lipSync videoUrl whenever its start moves (audio offset changes)", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({
          id: "b",
          start: 5,
          end: 10,
          status: "ready",
          source: "lipSync",
          videoUrl: "https://example.com/lip-b.mp4",
        }),
      ],
    });
    // either direction: the right clip's start moves, so its lip-sync no
    // longer aligns with the audio at frame 0 → must regenerate.
    useStore.getState().moveBoundary("b", 6);
    const [, b] = useStore.getState().clips;
    expect(b!.videoUrl).toBeUndefined();
    expect(b!.status).toBe("empty");
  });

  it("no-ops when the boundary can't move (lo >= hi)", () => {
    // Two clips already at MIN_CLIP_LEN-tight on both sides leave no room.
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: MIN_CLIP_LEN }),
        makeClip({ id: "b", start: MIN_CLIP_LEN, end: MIN_CLIP_LEN * 2 }),
      ],
    });
    const before = useStore.getState().clips;
    useStore.getState().moveBoundary("b", 0.3);
    const after = useStore.getState().clips;
    expect(after).toEqual(before);
  });
});
