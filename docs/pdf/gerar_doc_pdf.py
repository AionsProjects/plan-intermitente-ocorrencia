# -*- coding: utf-8 -*-
"""
Gerador de PDF no estilo "AIONS API - Guia de Integracao" (ReportLab/Platypus).
Renderer generico: le um dict DOC (sections -> blocks) e produz A4 PDF.

Uso:
    python gerar_doc_pdf.py            # gera os 2 PDFs (usuario + tecnico)

Conteudo vem de conteudo_usuario.py e conteudo_tecnico.py (dicts DOC).
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    XPreformatted, KeepTogether,
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

# ---- paleta (mono azul, conforme spec) ----
NAVY   = HexColor("#17375e")
BLUE   = HexColor("#2e75b6")
LINE   = HexColor("#afc0d2")
FILL_H = HexColor("#e7eef6")   # header de tabela
FILL_Z = HexColor("#f3f6f9")   # zebra / code bg
GREY_H = HexColor("#333333")   # running header
GREY_P = HexColor("#666666")   # page number / subtitle

# ---- geometria A4 (pt) ----
PW, PH = A4
ML, MR = 62, 62
MT, MB = 70, 55
CONTENT_W = PW - ML - MR        # ~471

# ---- estilos ----
_ss = getSampleStyleSheet()

def _styles():
    return {
        "title": ParagraphStyle("title", fontName="Helvetica", fontSize=22, textColor=NAVY,
                                 leading=26, spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", fontName="Helvetica-Oblique", fontSize=10,
                                    textColor=GREY_P, leading=14, spaceAfter=18),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, textColor=BLUE,
                             leading=18, spaceBefore=16, spaceAfter=8, keepWithNext=1),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, textColor=NAVY,
                             leading=14, spaceBefore=10, spaceAfter=4, keepWithNext=1),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, textColor=HexColor("#000000"),
                               leading=13, spaceAfter=6, alignment=TA_JUSTIFY),
        "callout": ParagraphStyle("callout", fontName="Helvetica", fontSize=9.5, textColor=HexColor("#000000"),
                                  leading=13, spaceAfter=6, alignment=TA_LEFT,
                                  leftIndent=8, borderColor=LINE, borderWidth=0, backColor=FILL_Z,
                                  borderPadding=(5, 5, 5, 8)),
        "li": ParagraphStyle("li", fontName="Helvetica", fontSize=9.5, textColor=HexColor("#000000"),
                             leading=13, spaceAfter=3, alignment=TA_LEFT, leftIndent=14, bulletIndent=4),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, textColor=HexColor("#000000"),
                               leading=11),
        "cellh": ParagraphStyle("cellh", fontName="Helvetica-Bold", fontSize=9, textColor=NAVY, leading=11),
        "code": ParagraphStyle("code", fontName="Courier", fontSize=8.5, textColor=HexColor("#10243b"),
                               leading=11),
    }

S = _styles()


def _on_page(canvas, doc):
    canvas.saveState()
    # running header
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY_H)
    canvas.drawString(ML, 815, doc._header_text)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(ML, 810, PW - MR, 810)
    # page number (bottom-right)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY_P)
    canvas.drawRightString(PW - MR, 38, str(canvas.getPageNumber()))
    canvas.restoreState()


def _table(header, rows, widths=None):
    """Tabela full-width, header navy, zebra, grid fino, Paragraph nas celulas."""
    data = []
    data.append([Paragraph(str(h), S["cellh"]) for h in header])
    for r in rows:
        data.append([Paragraph(str(c), S["cell"]) for c in r])
    if widths is None:
        n = len(header)
        widths = [CONTENT_W / n] * n
    else:
        total = float(sum(widths))
        widths = [CONTENT_W * (w / total) for w in widths]
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), FILL_H),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEAFTER", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 0.5, LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), FILL_Z))
    t.setStyle(TableStyle(style))
    return t


def _code(text):
    box = XPreformatted(text, S["code"])
    tbl = Table([[box]], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FILL_Z),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return tbl


def _render_blocks(blocks):
    flow = []
    for b in blocks:
        t = b.get("type")
        if t == "p":
            flow.append(Paragraph(b["text"], S["body"]))
        elif t == "h2":
            flow.append(Paragraph(b["text"], S["h2"]))
        elif t == "li":
            flow.append(Paragraph("&bull;&nbsp;&nbsp;" + b["text"], S["li"]))
        elif t == "callout":
            lead = b.get("label", "Importante")
            txt = '<b><font color="#2e75b6">%s:</font></b> %s' % (lead, b["text"])
            flow.append(Paragraph(txt, S["callout"]))
        elif t == "table":
            flow.append(_table(b["header"], b["rows"], b.get("widths")))
            flow.append(Spacer(1, 6))
        elif t == "code":
            flow.append(_code(b["text"]))
            flow.append(Spacer(1, 6))
        elif t == "spacer":
            flow.append(Spacer(1, b.get("h", 8)))
    return flow


def gerar(doc_dict, out_path):
    story = []
    # capa / bloco inicial
    story.append(Spacer(1, 6))
    story.append(Paragraph(doc_dict["title"], S["title"]))
    story.append(Paragraph(doc_dict["version_line"], S["subtitle"]))
    for sec in doc_dict["sections"]:
        head = "%s. %s" % (sec["n"], sec["title"]) if sec.get("n") else sec["title"]
        blocks_flow = _render_blocks(sec["blocks"])
        # heading nunca separa do 1o paragrafo
        first = blocks_flow[0] if blocks_flow else Spacer(1, 0)
        rest = blocks_flow[1:] if blocks_flow else []
        story.append(KeepTogether([Paragraph(head, S["h1"]), first]))
        story.extend(rest)

    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=ML, rightMargin=MR, topMargin=MT, bottomMargin=MB,
        title=doc_dict["title"], author="Contato Servicos - DP",
    )
    doc._header_text = doc_dict["header"]
    frame = Frame(ML, MB, CONTENT_W, PH - MT - MB, id="main",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="tpl", frames=[frame], onPage=_on_page)])
    doc.build(story)
    print("gerado:", out_path)


if __name__ == "__main__":
    from conteudo_usuario import DOC_USUARIO
    from conteudo_tecnico import DOC_TECNICO
    here = os.path.dirname(os.path.abspath(__file__))
    gerar(DOC_USUARIO, os.path.join(here, "Plano_Intermitentes_Guia_do_Usuario.pdf"))
    gerar(DOC_TECNICO, os.path.join(here, "Plano_Intermitentes_Manual_Tecnico.pdf"))
