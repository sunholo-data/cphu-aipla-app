#!/usr/bin/env python3
"""Spike: synthesize one Danish sentence on each TTS voice tier.

Run from the repo root:

    python scripts/spike_tts.py
    python scripts/spike_tts.py --text "Hvad er Plancks konstant?"
    python scripts/spike_tts.py --out-dir /tmp/tts_spike --listen

Drops one MP3 per voice into /tmp/tts_spike/ (or --out-dir). With
--listen, opens each file in sequence via `open` (macOS) for AR's
voice-pick session.

Auth: needs gcloud ADC (`gcloud auth application-default login`) and
access to a project with texttospeech.googleapis.com enabled. Defaults
to GOOGLE_CLOUD_PROJECT env (set to aipla-dev-2026 for the M0 setup).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
from pathlib import Path

# When run from scripts/ standalone, the backend package isn't on sys.path
# the way pytest sets it up. Add it manually so `from backend.voice...`
# resolves.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from backend.voice.providers.gcp_tts import GCPTTSProvider  # noqa: E402


DANISH_SAMPLE = "Hej! Hvad er Plancks konstant, og hvorfor er den vigtig i kvantemekanik?"


VOICE_PICKS: list[tuple[str, str, str]] = [
    # (tier, voice_name, file_label)
    ("standard", "da-DK-Standard-A", "standard-A"),
    ("standard", "da-DK-Standard-D", "standard-D"),
    ("wavenet", "da-DK-Wavenet-A", "wavenet-A"),
    ("wavenet", "da-DK-Wavenet-C", "wavenet-C"),
    ("wavenet", "da-DK-Wavenet-D", "wavenet-D"),
    ("wavenet", "da-DK-Wavenet-E", "wavenet-E"),
    ("neural2", "da-DK-Neural2-F", "neural2-F"),
    ("chirp3hd", "da-DK-Chirp3-HD-Aoede", "chirp3hd-Aoede"),
]


async def synthesize_one(tier: str, voice: str, label: str, text: str, out_dir: Path) -> Path:
    provider = GCPTTSProvider(tier=tier)
    audio, mime = await provider.synthesize(text=text, lang="da-DK", voice=voice, extras=None)
    out = out_dir / f"{label}.mp3"
    out.write_bytes(audio)
    size_kb = len(audio) / 1024
    print(f"  [{tier:9s}] {voice:32s} -> {out}  ({size_kb:.1f} KB, {mime})")
    return out


async def amain(text: str, out_dir: Path, listen: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Synthesizing Danish sample on {len(VOICE_PICKS)} voices:")
    print(f"  text: {text!r}")
    print(f"  out:  {out_dir}")
    print()

    paths: list[Path] = []
    for tier, voice, label in VOICE_PICKS:
        try:
            paths.append(await synthesize_one(tier, voice, label, text, out_dir))
        except Exception as exc:
            print(f"  [{tier:9s}] {voice:32s} -> FAILED: {exc}", file=sys.stderr)

    print()
    print(f"Done. {len(paths)} MP3s in {out_dir}.")

    if listen and sys.platform == "darwin":
        print("Opening each file via `open` (macOS) — press space to advance.")
        for p in paths:
            print(f"  -> {p.name}")
            subprocess.run(["open", str(p)], check=False)
            input("    [Enter for next]")
    elif listen:
        print("(--listen only auto-opens on macOS; play manually elsewhere.)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", default=DANISH_SAMPLE, help="Sample text to synthesize")
    parser.add_argument("--out-dir", default="/tmp/tts_spike", type=Path, help="Where to write MP3s")
    parser.add_argument("--listen", action="store_true", help="On macOS, open each MP3 in sequence")
    args = parser.parse_args()

    if not os.getenv("GOOGLE_CLOUD_PROJECT"):
        print(
            "WARN: GOOGLE_CLOUD_PROJECT not set. Defaulting via ADC; if it picks the "
            "wrong project, run: export GOOGLE_CLOUD_PROJECT=aipla-dev-2026",
            file=sys.stderr,
        )

    asyncio.run(amain(args.text, args.out_dir, args.listen))


if __name__ == "__main__":
    main()
