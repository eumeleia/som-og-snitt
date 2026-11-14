"""
Two-column A4 version of a knitting pattern, built from the same data.py and the same
fonts, styles and drawing code as the one-column original (oppskrifter/_work/scripts/
build_pdf.py, which is not changed). The text is the same, word for word: only the layout
differs.

Layout:
- page 1: the cover (title, photos, intro), as in the original;
- page 2 (and 3 if needed): the title, the spec table (yarn, sizes, ...) and the text and
  techniques before the pattern itself, in one column as in the original;
- then, on a new page: the pattern itself in two columns, the left column first, balanced
  before anything that runs across the page;
- after the pattern (from the next page break in the source: abbreviations, tutorials,
  charts, notes): one column again.
Where the pattern itself starts is the heading in data["columns_from"], or COLUMNS_FROM
below, or else the first block; it ends at data["columns_to"] or else the first page break. A table, chart, image or legend that is
wider than a column breaks the columns and stands across the page at its original size.
Nothing is scaled down.

Usage:
    python3 scripts/recipes/two_column.py oppskrifter/_work/<pattern>/data.py [out.pdf]
Default output: oppskrifter/To spalter/<same file name as the original>.

Needs oppskrifter/_work (on Maria's Mac only, gitignored) for build_pdf.py and the fonts.
See docs/oppskrift-oppsett.md.
"""
import copy
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(REPO, "oppskrifter", "_work")
OUT_DIR = os.path.join(REPO, "oppskrifter", "To spalter")
sys.path.insert(0, os.path.join(WORK, "scripts"))

import build_pdf as base  # noqa: E402  (registers the fonts and styles)
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfgen import canvas as rl_canvas  # noqa: E402
from reportlab.platypus import Flowable, Paragraph, Spacer, Table, TableStyle  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402

A4 = (base.PAGE_W, base.PAGE_H)
MARGIN = base.MARGIN
CONTENT_W = base.CONTENT_W
GAP = 8 * mm
COL_W = (CONTENT_W - GAP) / 2
# The original stops content 10 mm above the bottom margin, where the footer rule is.
FRAME_BOTTOM = MARGIN + 10 * mm
TOP = base.PAGE_H - MARGIN
# Column text that would end up alone on a page in less than this height (a few lines)
# takes its whole section along instead.
MIN_TAIL = 30 * mm

# Patterns whose body starts with general text and techniques before the pattern itself.
COLUMNS_FROM = {
    "charlotte-jacket-mini": "Pattern",
    "butterscotch-sweater-adult": "Pattern",
}

# Layout choices Maria has asked for on a single pattern (or "layout" in its data.py):
# spec_on_cover: the spec table goes on the cover under a smaller photo, and the pattern
#   starts on page 2;
# drop_back_image: no back page with the photo.
LAYOUT = {
    "chunky-selbugenser": {"spec_on_cover": True, "drop_back_image": True},
}

HEADING = copy.copy(base.STYLE_HEADING)
HEADING.keepWithNext = 1
TITLE_LOGO = ParagraphStyle("logo", fontName="Poppins-Bold", fontSize=15, leading=18, alignment=1,
                            textColor=base.BLACK, spaceAfter=10)
TITLE = ParagraphStyle("title", fontName="Poppins-Bold", fontSize=22, leading=26, alignment=1,
                       textColor=base.BLACK, spaceAfter=6)
HANDLE = ParagraphStyle("handle", fontName="Poppins-Italic", fontSize=11.5, leading=15, alignment=1,
                        textColor=base.BLACK, spaceAfter=10)
CREDIT = ParagraphStyle("credit", fontName="Poppins", fontSize=9.5, leading=13, alignment=1,
                        textColor=base.BLACK)


class _Shim(base.Doc):
    """build_pdf's Doc drawing into a flowable's own box: no page breaks."""

    def need_space(self, h):
        pass

    def new_page(self, footer=True):
        pass


def _shim(canv, height):
    d = _Shim(canv, "", "")
    d.y = height
    return d


class Rule(Flowable):
    def __init__(self, pad_before=4, pad_after=6):
        super().__init__()
        self.pad_before, self.pad_after = pad_before, pad_after

    def wrap(self, aw, ah):
        self.width = aw
        return aw, self.pad_before + self.pad_after

    def draw(self):
        c = self.canv
        c.setStrokeColor(base.GREY_RULE)
        c.setLineWidth(0.6)
        c.line(0, self.pad_after, self.width, self.pad_after)


class Legend(Flowable):
    ROW_H = 7 * mm

    def __init__(self, entries):
        super().__init__()
        self.entries = entries
        text_w = max(base.pdfmetrics.stringWidth(label, "Poppins", 9) for _, label in entries)
        self.width = 4.5 * mm + 3 * mm + text_w
        self.height = self.ROW_H * len(entries) + 2 * mm

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        self.canv.saveState()
        self.canv.translate(-MARGIN, 0)
        _shim(self.canv, self.height).draw_legend(self.entries)
        self.canv.restoreState()


class Diagram(Flowable):
    """A colour-work chart drawn by build_pdf at its original cell size."""

    def __init__(self, block):
        super().__init__()
        self.b = block
        cell = block.get("cell_mm", 7.0) * mm
        has_labels = any(r[0] is not None for r in block["rows"])
        label_w = 7 * mm if has_labels else 1 * mm
        right = 8 * mm if block.get("row_labels_on_right") else 0
        self.width = label_w + len(block["col_labels"]) * cell + right
        title_h = 16 * mm if block.get("title") else 0
        self.height = title_h + len(block["rows"]) * cell + 9 * mm

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        b = self.b
        self.canv.saveState()
        self.canv.translate(-MARGIN, 0)
        _shim(self.canv, self.height).draw_diagram_grid(
            b.get("title"), b["col_labels"], b["rows"], cell_mm=b.get("cell_mm", 7.0),
            decreases=b.get("decreases"), row_labels_on_right=b.get("row_labels_on_right", False),
            x0=MARGIN, top_y=self.height, advance_y=False)
        self.canv.restoreState()


class Picture(Flowable):
    """An image at the size the original gives it: fitted to the full width and max_h."""

    def __init__(self, path, max_h, max_w=CONTENT_W, pad=4):
        super().__init__()
        self.path = path
        self.w, self.h, self.ir = base.img_dims_fit(path, max_w, max_h)
        self.pad = pad

    def wrap(self, aw, ah):
        self.avail = aw
        return aw, self.h + self.pad

    def draw(self):
        self.canv.drawImage(self.ir, (self.avail - self.w) / 2, self.pad, width=self.w, height=self.h)


class SideBySide(Flowable):
    """Two blocks next to each other, as in the original (always across the page)."""

    def __init__(self, block):
        super().__init__()
        self.b = block
        gap = block.get("gap_mm", 8) * mm
        self.left_w = CONTENT_W * block.get("left_frac", 0.58) - gap / 2
        self.right_w = CONTENT_W - self.left_w - gap
        self.right_x0 = MARGIN + self.left_w + gap
        self.height = max(self._h(block["left"], self.left_w), self._h(block["right"], self.right_w))

    @staticmethod
    def _h(spec, w):
        if spec["type"] == "image":
            return base.img_dims_fit(spec["path"], w, spec.get("max_h", 250 * mm))[1] + 4
        cell = spec.get("cell_mm", 7.0) * mm
        return (16 * mm if spec.get("title") else 0) + len(spec["rows"]) * cell + 9 * mm

    def wrap(self, aw, ah):
        return CONTENT_W, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.translate(-MARGIN, 0)
        d = _shim(c, self.height)
        for spec, x0, w in ((self.b["left"], MARGIN, self.left_w), (self.b["right"], self.right_x0, self.right_w)):
            if spec["type"] == "image":
                d.draw_image_block(spec["path"], max_h=spec.get("max_h", 250 * mm), x0=x0, max_w=w,
                                   top_y=self.height, advance_y=False)
            else:
                d.draw_diagram_grid(spec.get("title"), spec["col_labels"], spec["rows"],
                                    cell_mm=spec.get("cell_mm", 7.0), decreases=spec.get("decreases"),
                                    row_labels_on_right=spec.get("row_labels_on_right", False),
                                    x0=x0, top_y=self.height, advance_y=False)
        c.restoreState()


def spec_table(rows, width):
    label_w = 36 * mm
    data = [[Paragraph(f"<b>{label}</b>", base.STYLE_SPEC_LABEL), Paragraph(value, base.STYLE_SPEC_VALUE)]
            for label, value in rows]
    t = Table(data, colWidths=[label_w, width - label_w])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def note_box(i, n, width):
    html = f"<b>Mulig feil {i + 1}: {n['title']}</b><br/><br/>{n['body']}"
    t = Table([[Paragraph(html, base.STYLE_NOTE)]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, base.GREY_RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 6)]


def fits_column(f):
    """True when a drawing fits a column at its original size."""
    if isinstance(f, Picture):
        return f.w <= COL_W
    if isinstance(f, (Diagram, Legend)):
        return f.width <= COL_W
    return False


PAGEBREAK = object()


class Story:
    """Collects the pattern as segments: runs of text for the two columns, and blocks that
    run across the page, which close the columns before them."""

    def __init__(self):
        self.segments = []
        self.cols = []

    def col(self, *fs):
        self.cols.extend(fs)

    def full(self, *fs):
        # A heading that ends the column text belongs to what runs across the page after
        # it: it moves out of the columns and stays with it.
        moved = []
        while self.cols and _keeps(self.cols[-1]):
            moved.insert(0, self.cols.pop())
        self.close()
        for f in moved + list(fs):
            self.segments.append(("break",) if f is PAGEBREAK else ("full", f))

    def drawing(self, f, caption=None, in_pattern=True):
        cap = [Paragraph(caption, base.STYLE_NOTE)] if caption else []
        if in_pattern and fits_column(f):
            self.col(f, *cap)
        else:
            self.full(f, *cap)

    def close(self):
        if self.cols:
            self.segments.append(("cols", self.cols))
            self.cols = []


# ---------- Layout ----------

def _keeps(f):
    return isinstance(f, Paragraph) and getattr(f.style, "keepWithNext", 0)


def fill(fs, aw, ah):
    """Fills one column of width aw and height ah. Returns what was placed, as
    (flowable, offset from the top, height), and what is left. Paragraphs and tables split
    at the bottom, as Platypus frames split them; a heading moves with what follows it."""
    fs = list(fs)
    placed = []
    y = 0
    while fs:
        f = fs[0]
        sb = f.getSpaceBefore() if y > 0 else 0
        _, h = f.wrap(aw, ah)
        need_next = 0
        if _keeps(f) and len(fs) > 1:
            need_next = min(fs[1].wrap(aw, ah)[1], 40)
        if y + sb + h + need_next <= ah:
            placed.append((f, y + sb, h))
            y += sb + h + f.getSpaceAfter()
            fs.pop(0)
            continue
        room = ah - y - sb
        parts = f.split(aw, room) if room > 0 and not _keeps(f) else []
        if len(parts) >= 2:
            _, h1 = parts[0].wrap(aw, room)
            placed.append((parts[0], y + sb, h1))
            fs[0:1] = parts[1:]
            return placed, fs
        if y == 0 and not placed:
            # Taller than an empty column: placed anyway, so the layout always moves on.
            placed.append((f, 0, h))
            fs.pop(0)
        return placed, fs
    return placed, fs


class Layout:
    def __init__(self, c, footer):
        self.c = c
        self.footer = footer
        self.page = 1
        self.y = TOP

    def new_page(self):
        self.footer(self.c, self.page)
        self.c.showPage()
        self.page += 1
        self.y = TOP

    def page_break(self):
        if self.y < TOP:
            self.new_page()

    def full(self, f):
        sb = f.getSpaceBefore() if self.y < TOP else 0
        _, h = f.wrap(CONTENT_W, TOP - FRAME_BOTTOM)
        if self.y - sb - h < FRAME_BOTTOM:
            room = self.y - sb - FRAME_BOTTOM
            parts = f.split(CONTENT_W, room) if room > 0 else []
            if len(parts) >= 2:
                self.full(parts[0])
                self.new_page()
                for part in parts[1:]:
                    self.full(part)
                return
            if self.y < TOP:
                self.new_page()
                return self.full(f)
        f.wrap(CONTENT_W, TOP - FRAME_BOTTOM)
        f.drawOn(self.c, MARGIN, self.y - sb - h)
        self.y -= sb + h + f.getSpaceAfter()

    def _draw(self, placed, x):
        for f, off, h in placed:
            # Measuring (the balancing tries many heights) can leave a paragraph without
            # its lines; wrap it again at the column width before drawing.
            f.wrap(COL_W, h + 1)
            f.drawOn(self.c, x, self.y - off - h)

    @staticmethod
    def _used(placed):
        return max((off + h for _, off, h in placed), default=0)

    def _balanced(self, fs, ah):
        """The lowest column height that holds all of fs in two columns (at most ah)."""
        lo, hi = 0.0, ah
        for _ in range(24):
            mid = (lo + hi) / 2
            l2, r2 = fill(fs, COL_W, mid)
            rr, left_over = fill(r2, COL_W, mid)
            if left_over or self._used(l2) > mid + 0.01 or self._used(rr) > mid + 0.01:
                lo = mid
            else:
                hi = mid
        return hi

    def columns(self, fs, page_ends_after=False):
        fs = list(fs)
        right_x = MARGIN + COL_W + GAP
        while fs:
            ah = self.y - FRAME_BOTTOM
            if ah < 40:
                self.new_page()
                continue
            left, rest = fill(fs, COL_W, ah)
            right, rest2 = fill(rest, COL_W, ah)
            if rest2 and page_ends_after and self._balanced(rest2, TOP - FRAME_BOTTOM) < MIN_TAIL:
                # Only a few lines would go on a page of their own: move the whole last
                # section (from its heading) to the next page instead.
                on_page = [f for f, _, _ in left + right]
                cut = max((k for k, f in enumerate(fs) if k > 0 and _keeps(f) and any(f is p for p in on_page)), default=None)
                if cut is not None:
                    self.columns(fs[:cut])
                    self.new_page()
                    fs = fs[cut:]
                    continue
            if rest2:
                self._draw(left, MARGIN)
                self._draw(right, right_x)
                fs = rest2
                self.new_page()
                continue
            # The rest fits on this page: balance the two columns, left column first.
            hi = self._balanced(fs, ah)
            left, rest = fill(fs, COL_W, hi)
            right, _ = fill(rest, COL_W, hi)
            self._draw(left, MARGIN)
            self._draw(right, right_x)
            self.y -= max(self._used(left), self._used(right)) + 6
            return


def pattern_range(data, key):
    """Indices [start, end) of the body blocks that are the pattern itself."""
    body = data["body"]
    heading = data.get("columns_from") or COLUMNS_FROM.get(key)
    start = 0
    if heading:
        start = next(i for i, b in enumerate(body) if b["kind"] == "heading" and b["text"] == heading)
    end_heading = data.get("columns_to")
    if end_heading:
        end = next(i for i, b in enumerate(body) if i > start and b["kind"] == "heading" and b["text"] == end_heading)
    else:
        end = next((i for i, b in enumerate(body) if i > start and b["kind"] == "pagebreak"), len(body))
    return start, end


def _height(fs):
    total = 0
    for f in fs:
        total += f.getSpaceBefore() + f.wrap(CONTENT_W, TOP)[1] + f.getSpaceAfter()
    return total


def build(data, out_path, key=None):
    s = Story()
    opts = {**LAYOUT.get(key, {}), **(data.get("layout") or {})}
    spec_on_cover = opts.get("spec_on_cover", False)
    info = [spec_table(data["spec"], CONTENT_W)]
    if data.get("spec_note"):
        info += [Rule(3, 4), Paragraph(data["spec_note"], base.STYLE_NOTE)]

    # ---------- Cover (across the page) ----------
    head = []
    if data.get("logo_text"):
        head.append(Paragraph(data["logo_text"], TITLE_LOGO))
    head.append(Paragraph(data["title"].upper(), TITLE))
    if data.get("designer_handle"):
        head.append(Paragraph(data["designer_handle"], HANDLE))
    intro = [Paragraph(p, base.STYLE_INTRO) for p in data.get("intro") or []]
    photo_h, photo_h2 = 150 * mm, 130 * mm
    if spec_on_cover:
        # The photo shrinks so the title, photo and spec all fit on the cover.
        room = TOP - FRAME_BOTTOM - _height(head + intro + info) - 12 * mm
        photo_h = photo_h2 = min(photo_h, room)
    s.full(*head)
    covers = data["cover_images"]
    if len(covers) == 1:
        s.full(Picture(covers[0], photo_h))
    else:
        each_w = (CONTENT_W - 4 * mm) / 2
        row = [[Picture(p, photo_h2, max_w=each_w) for p in covers]]
        t = Table(row, colWidths=[each_w + 2 * mm] * len(covers))
        t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        s.full(t)
    s.full(*intro)
    if spec_on_cover:
        s.full(Spacer(1, 6 * mm), *info)
    else:
        s.full(PAGEBREAK)
        # ---------- Info page: title, spec and what comes before the pattern, one column ----------
        s.full(Paragraph(f"<b>{data['title']}</b>", base.STYLE_HEADING), *info)

    start, end = pattern_range(data, key)
    for i, block in enumerate(data["body"]):
        if i == start:
            # The pattern itself always starts at the top of a new page.
            s.full(PAGEBREAK)
        text = s.col if start <= i < end else s.full
        kind = block["kind"]
        if kind == "heading":
            text(Paragraph(f"<b>{block['text']}</b>", HEADING))
        elif kind == "para":
            text(Paragraph(block["text"], base.STYLE_PARA))
        elif kind == "step":
            text(Paragraph(f"<b>{block['label']}</b> {block['text']}", base.STYLE_STEP))
        elif kind == "rule":
            text(Rule())
        elif kind == "image":
            s.drawing(Picture(block["path"], block.get("max_h", 150 * mm)), block.get("caption"), start <= i < end)
        elif kind == "diagram":
            s.drawing(Diagram(block), block.get("caption"), start <= i < end)
        elif kind == "legend":
            s.drawing(Legend(block["entries"]), None, start <= i < end)
        elif kind == "side_by_side":
            s.full(SideBySide(block))
        elif kind == "pagebreak":
            s.full(PAGEBREAK)
        else:
            raise ValueError(f"unknown block kind {kind}")

    # ---------- Back page ----------
    if data.get("back_image") and not opts.get("drop_back_image"):
        s.full(PAGEBREAK, Picture(data["back_image"], base.PAGE_H - 2 * MARGIN - 16 * mm),
               Spacer(1, 6), Paragraph(data["back_credit"], CREDIT))

    # ---------- Merknader ----------
    if data.get("notes"):
        s.full(PAGEBREAK, Paragraph("<b>Merknader ved avskrift</b>", base.STYLE_HEADING))
        for i, n in enumerate(data["notes"]):
            s.full(*note_box(i, n, CONTENT_W))

    # ---------- Appendix: original chart photos, across the page ----------
    if data.get("appendix_images"):
        s.full(PAGEBREAK, Paragraph("<b>Vedlegg</b>", base.STYLE_HEADING),
               Paragraph("Originalbilde(r) av diagram som er tegnet på nytt i oppskriften, lagt ved som ekstra referanse.",
                         base.STYLE_NOTE))
        items = data["appendix_images"]
        for k, item in enumerate(items):
            s.full(Picture(item["path"], item.get("max_h", 230 * mm)))
            if item.get("caption"):
                s.full(Paragraph(item["caption"], base.STYLE_NOTE))
            if k < len(items) - 1:
                s.full(PAGEBREAK)
    s.close()

    def footer(canv, page):
        if page == 1:
            return
        canv.saveState()
        canv.setStrokeColor(base.GREY_RULE)
        canv.setLineWidth(0.5)
        canv.line(MARGIN, MARGIN - 2 * mm, base.PAGE_W - MARGIN, MARGIN - 2 * mm)
        canv.setFont("Poppins", 8.5)
        canv.setFillColor(base.BLACK)
        canv.drawString(MARGIN, MARGIN - 7 * mm, f"{data['title']}  ·  {data['designer']}")
        canv.drawRightString(base.PAGE_W - MARGIN, MARGIN - 7 * mm, str(page))
        canv.restoreState()

    c = rl_canvas.Canvas(out_path, pagesize=A4)
    c.setTitle(data["title"])
    c.setAuthor(data["designer"])
    c.setSubject(data.get("subject", ""))
    lay = Layout(c, footer)
    for k, seg in enumerate(s.segments):
        if seg[0] == "break":
            lay.page_break()
        elif seg[0] == "full":
            nxt = s.segments[k + 1] if k + 1 < len(s.segments) else None
            if _keeps(seg[1]) and nxt and nxt[0] == "full":
                # A heading never ends a page: it goes to the next page with what follows.
                h = seg[1].wrap(CONTENT_W, TOP)[1] + seg[1].getSpaceBefore() + nxt[1].wrap(CONTENT_W, TOP)[1]
                if lay.y - h < FRAME_BOTTOM and lay.y < TOP:
                    lay.new_page()
            lay.full(seg[1])
        else:
            nxt = s.segments[k + 1] if k + 1 < len(s.segments) else None
            lay.columns(seg[1], page_ends_after=nxt is None or nxt[0] == "break")
    footer(c, lay.page)
    c.showPage()
    c.save()


if __name__ == "__main__":
    data = base.load_data(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT_DIR, os.path.basename(data["out_path"]))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    build(data, out, key=os.path.basename(os.path.dirname(os.path.abspath(sys.argv[1]))))
    print("wrote", out)
