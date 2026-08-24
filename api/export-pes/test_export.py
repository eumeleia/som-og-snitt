"""
Tests for bygg_monster() / sett_rammeflagg() / selvsjekk() in the PES export endpoint.

Run from the project root:
    python -m pytest api/export-pes/test_export.py

Loaded under a module name distinct from api/convert-image/index.py — both files are
called index.py, and a plain "from index import ..." would collide during collection
across api/ (see api/convert-image/test_convert.py for the sibling that owns "index").
"""

import importlib.util
import os
import struct

_spec = importlib.util.spec_from_file_location(
    "export_pes_index", os.path.join(os.path.dirname(__file__), "index.py"))
export_pes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_pes)


def _fire_fargesegmenter():
    return [
        {'farge_hex': '#FF0000', 'blokker': [[[0, 0], [10, 0], [20, 0], [30, 0]]]},
        {'farge_hex': '#00FF00', 'blokker': [[[0, 0], [10, 10], [20, 20], [30, 30]]]},
        {'farge_hex': '#0000FF', 'blokker': [[[0, 0], [0, 10], [0, 20], [0, 30]]]},
        {'farge_hex': '#FFFF00', 'blokker': [[[0, 0], [-10, 0], [-20, 0], [-30, 0]]]},
    ]


def test_bygg_monster_nullstiller_rammeflagg():
    pes = export_pes.bygg_monster(_fire_fargesegmenter(), 1)
    assert pes[:8] == b'#PES0001'
    assert struct.unpack('<HH', pes[12:16]) == (0, 0)


def test_selvsjekk_ok_for_samme_monster():
    segmenter = _fire_fargesegmenter()
    pes = export_pes.bygg_monster(segmenter, 1)
    ok, resultat = export_pes.selvsjekk(pes, segmenter)
    assert ok is True
    assert resultat['antall_fargekjoringer'] == 4
