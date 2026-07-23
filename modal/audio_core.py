"""Shared audio-analysis logic. Pure function, no Modal/FastAPI dependencies.

Imported by:
  - audio_analysis.py (Modal endpoint, prod)
  - local_server.py   (FastAPI sidecar, dev)
"""

from __future__ import annotations

import io
from typing import Any


def analyze_bytes(audio_bytes: bytes, sections_k: int = 0) -> dict[str, Any]:
    """Run BPM / beat / section / RMS / key extraction on raw audio bytes.

    `sections_k=0` (default) auto-picks the section count from duration; pass a
    positive value to force a specific count.

    Returns the same JSON shape that the Modal endpoint and the local sidecar
    both expose, so the Fastify caller is identical regardless of where it runs.
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(io.BytesIO(audio_bytes), sr=22050, mono=True)
    duration = float(len(y) / sr)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    bpm = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    downbeats = beats[::4]  # 4/4 assumption

    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames")
    onsets = librosa.frames_to_time(onset_frames, sr=sr).tolist()

    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    n_sec = max(1, int(round(duration)))
    rms_resampled = np.interp(np.linspace(0, duration, n_sec), rms_times, rms)
    rms_max = float(rms_resampled.max()) or 1.0
    rms_curve = (rms_resampled / rms_max).tolist()

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key_idx = int(np.argmax(chroma.mean(axis=1)))
    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    key = key_names[key_idx]

    sections = _detect_sections(
        y=y,
        sr=sr,
        duration=duration,
        bpm=bpm,
        beat_frames=beat_frames,
        chroma=chroma,
        rms=rms,
        downbeats=downbeats,
        sections_k=sections_k,
    )

    return {
        "duration": duration,
        "bpm": bpm,
        "key": key,
        "beats": beats,
        "downbeats": downbeats,
        "onsets": onsets,
        "rms_curve": rms_curve,
        "sections": sections,
    }


def _detect_sections(
    *,
    y: Any,
    sr: int,
    duration: float,
    bpm: float,
    beat_frames: Any,
    chroma: Any,
    rms: Any,
    downbeats: list[float],
    sections_k: int,
) -> list[dict[str, Any]]:
    """Section boundaries from beat-synced multi-feature stack (chroma + MFCC +
    RMS), snapped to nearest downbeat, with sections shorter than ~one phrase
    merged out.

    Why multi-feature: chroma alone misses verse→chorus transitions that don't
    move harmonically (very common in pop/rock). MFCC catches timbre/texture
    changes; RMS catches dynamic shifts (drum drop, bridge breakdown).
    """
    import librosa
    import numpy as np
    # Beat-synced features
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    mfcc_sync = librosa.util.sync(mfcc, beat_frames, aggregate=np.mean)
    chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
    rms_sync = librosa.util.sync(rms.reshape(1, -1), beat_frames, aggregate=np.mean)

    # Z-score per feature row so chroma's [0,1] range doesn't dominate MFCC's
    # ~[-50, 50] or RMS's tiny absolute values.
    def zscore(x: Any) -> Any:
        m = x.mean(axis=1, keepdims=True)
        s = x.std(axis=1, keepdims=True) + 1e-9
        return (x - m) / s

    features = np.vstack([zscore(chroma_sync), zscore(mfcc_sync), zscore(rms_sync)])

    # Auto-pick k unless caller forced one. ~1 boundary per 25s, clamped to
    # [4, 12] — covers a 2-min single (4 sections) up to a 5-min track (12).
    if sections_k <= 0:
        sections_k = max(4, min(12, int(round(duration / 25.0))))
    # agglomerative needs k <= number of beat-synced frames
    sections_k = max(2, min(sections_k, features.shape[1] - 1))

    boundary_beats = librosa.segment.agglomerative(features, k=sections_k)
    # agglomerative's first boundary is always index 0 of the beat-synced
    # matrix — i.e., the time of the first detected beat, not a real
    # transition. Drop it; we always start the timeline at 0.0 below. (Without
    # this we get a tiny "section 1" between t=0 and the first beat for any
    # song with a pre-beat intro.)
    interior_beats = boundary_beats[1:]
    raw_times = librosa.frames_to_time(beat_frames[interior_beats], sr=sr).tolist()

    # Snap each boundary to the nearest downbeat if one is within ~0.6 of a
    # bar — keeps cuts on the grid the listener feels.
    bar_dur = 60.0 / max(bpm, 1.0) * 4.0
    tol = bar_dur * 0.6
    snapped: list[float] = []
    for t in raw_times:
        if not downbeats:
            snapped.append(t)
            continue
        nearest = min(downbeats, key=lambda d: abs(d - t))
        snapped.append(nearest if abs(nearest - t) <= tol else float(t))

    # Combine with timeline endpoints, dedup, sort.
    all_boundaries = sorted(set([0.0, float(duration)] + [float(s) for s in snapped]))

    # Drop interior boundaries that would create sections shorter than one
    # phrase (~4 bars). Snapping can collapse two boundaries onto the same
    # downbeat or just-after one, so this matters more after snapping.
    min_len = max(4.0, bar_dur * 4.0)
    pruned: list[float] = [all_boundaries[0]]
    for b in all_boundaries[1:-1]:
        if b - pruned[-1] >= min_len:
            pruned.append(b)
    last = all_boundaries[-1]
    if last - pruned[-1] < min_len and len(pruned) > 1:
        # Final section would be too short — replace the last interior boundary
        # with `duration` rather than appending.
        pruned[-1] = last
    else:
        pruned.append(last)

    return [
        {
            "start": float(pruned[i]),
            "end": float(pruned[i + 1]),
            "label": f"section {i + 1}",
        }
        for i in range(len(pruned) - 1)
    ]
