#!/usr/bin/env python3
"""BrowserMCP License Key Generator

Generates valid BMCP-XXXX-XXXX-XXXX-XXXX license keys.
Keys are validated offline in the extension via SHA-256(key + secret).

Usage:
    python3 keygen.py [count]

    count: Number of keys to generate (default: 1)
"""

import hashlib
import random
import sys

PRO_SECRET = "bmcp_2024_pro_salt"
CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # No I, O, 0, 1

def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()

def is_valid_key(key: str) -> bool:
    """Check if a key passes validation: SHA-256(key|secret) starts with 'cafe'."""
    h = sha256(f"{key}|{PRO_SECRET}")
    return h.startswith("cafe")

def generate_key() -> str | None:
    """Brute-force a valid key by trying random combinations."""
    # Generate first 3 segments randomly, then brute-force the last segment
    segments = []
    for _ in range(3):
        seg = "".join(random.choice(CHARS) for _ in range(4))
        segments.append(seg)
    
    prefix = f"BMCP-{segments[0]}-{segments[1]}-{segments[2]}-"
    
    # Brute-force the last segment (~32^4 = ~1M attempts, fast in Python)
    for c1 in CHARS:
        for c2 in CHARS:
            for c3 in CHARS:
                for c4 in CHARS:
                    key = prefix + c1 + c2 + c3 + c4
                    if is_valid_key(key):
                        return key
    return None

def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print(f"Generating {count} license key(s)...\n")
    for i in range(count):
        key = generate_key()
        if key:
            # Verify
            assert is_valid_key(key), f"Generated key failed validation: {key}"
            print(f"  Key {i+1}: {key}")
        else:
            print(f"  Key {i+1}: FAILED to generate")
    print(f"\n✅ Done. Keys can be activated in BrowserMCP → Pro → Activate.")

if __name__ == "__main__":
    main()