import sys
import json
from pathlib import Path

# Ensure audio_core can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio_core import analyze_bytes

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_cli.py <audio_file_path> [sections_k]", file=sys.stderr)
        sys.exit(1)

    file_path = Path(sys.argv[1])
    sections_k = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    if not file_path.exists():
        print(f"Error: File not found {file_path}", file=sys.stderr)
        sys.exit(1)

    try:
        audio_bytes = file_path.read_bytes()
        result = analyze_bytes(audio_bytes, sections_k)
        print(json.dumps(result))
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
