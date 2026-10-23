import argparse
import array
import re
import wave
from pathlib import Path


TIME_PATTERN = re.compile(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})")


def timestamp_seconds(value: str) -> float:
    match = TIME_PATTERN.fullmatch(value)
    if match is None:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    hours, minutes, seconds, milliseconds = map(int, match.groups())
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--srt", required=True, type=Path)
    parser.add_argument("--audio-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--duration", required=True, type=int)
    args = parser.parse_args()

    blocks = args.srt.read_text(encoding="utf-8-sig").strip().split("\n\n")
    entries = []
    for block in blocks:
        lines = block.strip().splitlines()
        cue_id = int(lines[0])
        start, _ = lines[1].split(" --> ", maxsplit=1)
        entries.append((cue_id, timestamp_seconds(start)))

    first_path = args.audio_dir / f"{entries[0][0]:03}.wav"
    with wave.open(str(first_path), "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        sample_rate = source.getframerate()
        if channels != 1 or sample_width != 2 or source.getcomptype() != "NONE":
            raise ValueError("Narration cues must be mono 16-bit PCM WAV files")

    output_frames = sample_rate * args.duration
    mixed = array.array("h", [0]) * output_frames
    for cue_id, start_time in entries:
        cue_path = args.audio_dir / f"{cue_id:03}.wav"
        with wave.open(str(cue_path), "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
                channels,
                sample_width,
                sample_rate,
            ):
                raise ValueError(f"Unexpected audio format in {cue_path}")
            samples = array.array("h", source.readframes(source.getnframes()))

        offset = round(start_time * sample_rate)
        count = min(len(samples), output_frames - offset)
        for index in range(max(0, count)):
            mixed[offset + index] = max(-32768, min(32767, mixed[offset + index] + samples[index]))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.output), "wb") as destination:
        destination.setnchannels(channels)
        destination.setsampwidth(sample_width)
        destination.setframerate(sample_rate)
        destination.writeframes(mixed.tobytes())

    for cue_id, _ in entries:
        (args.audio_dir / f"{cue_id:03}.wav").unlink(missing_ok=True)
    args.audio_dir.rmdir()
    print(f"Assembled {len(entries)} narration cues at {sample_rate} Hz for {args.duration} seconds")


if __name__ == "__main__":
    main()