"""
Tests for sett_rammeflagg() in the image-to-PES conversion pipeline.

Run from the project root:
    python -m pytest api/convert-image/test_rammeflagg.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from index import sett_rammeflagg


def test_sett_rammeflagg_uendret_uten_pes_signatur():
    ikke_pes = b'ikke en PES-fil, bare noen tilfeldige bytes her'
    assert sett_rammeflagg(ikke_pes) == ikke_pes


def test_sett_rammeflagg_uendret_naar_for_kort():
    for_kort = b'#PES0001' + bytes(4)
    assert sett_rammeflagg(for_kort) == for_kort
