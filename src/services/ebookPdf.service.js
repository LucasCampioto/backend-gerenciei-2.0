/**
 * Gera o PDF do eBook com layout da marca Gerenciei (pdf-lib):
 * capa magenta com arco de sorriso, sumário, capítulos com barra de acento,
 * bullets, caixas de destaque ("Dica") e rodapé com página + marca.
 */
async function buildEbookPdfBuffer(ebook, { clinicName = 'Gerenciei' } = {}) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 56;
  const MAX_W = PAGE_W - MARGIN * 2;
  const FOOTER_Y = 36;

  const MAGENTA = rgb(0.859, 0.153, 0.467); // #db2777
  const MAGENTA_DARK = rgb(0.68, 0.1, 0.36);
  const LIME = rgb(0.639, 0.839, 0.208); // #a3d635
  const INK = rgb(0.13, 0.12, 0.16);
  const GRAY = rgb(0.45, 0.44, 0.5);
  const ROSE_SOFT = rgb(0.992, 0.933, 0.96); // caixa de destaque
  const CREAM = rgb(0.996, 0.98, 0.955);

  const sections = (ebook.sections || []).filter((s) => s && (s.heading || s.body));

  // sanitiza para WinAnsi (Helvetica não suporta todos os glifos)
  const clean = (text) =>
    String(text || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[\u2022\u25CF\u25AA]/g, '-')
      // marcadores de markdown que não são renderizados aqui
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .replace(/^#+\s*/, '')
      // remove emojis e glifos fora do latim básico/latim-1
      .replace(/[^\u0000-\u00FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  /** Divide texto com **negrito** de markdown em segmentos { text, bold }. */
  const parseInlineMarkdown = (text) => {
    const parts = String(text || '').split('**');
    const segments = [];
    parts.forEach((part, i) => {
      if (part) segments.push({ text: part, bold: i % 2 === 1 });
    });
    return segments;
  };

  /**
   * Quebra texto com negrito inline em linhas de tokens { word, f, w },
   * medindo cada palavra com a fonte correta (normal ou bold).
   */
  const layoutRich = (text, size, maxWidth, baseF = font) => {
    const tokens = [];
    for (const segment of parseInlineMarkdown(text)) {
      const f = segment.bold ? fontBold : baseF;
      for (const word of clean(segment.text).split(' ').filter(Boolean)) {
        tokens.push({ word, f, w: f.widthOfTextAtSize(word, size) });
      }
    }
    const spaceW = baseF.widthOfTextAtSize(' ', size);
    const lines = [];
    let line = [];
    let width = 0;
    for (const token of tokens) {
      const extra = (line.length ? spaceW : 0) + token.w;
      if (width + extra > maxWidth && line.length) {
        lines.push(line);
        line = [token];
        width = token.w;
      } else {
        line.push(token);
        width += extra;
      }
    }
    if (line.length) lines.push(line);
    return { lines, spaceW };
  };

  const wrap = (text, size, f = font, maxWidth = MAX_W) => {
    const words = clean(text).split(' ').filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  // ---------- Capa ----------
  const cover = doc.addPage([PAGE_W, PAGE_H]);
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: MAGENTA });
  // faixa inferior mais escura para profundidade
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 140, color: MAGENTA_DARK });

  // arco de sorriso lima (semicírculo feito com círculo cortado pela faixa)
  cover.drawCircle({
    x: PAGE_W / 2,
    y: 240,
    size: 95,
    borderColor: LIME,
    borderWidth: 16,
  });
  cover.drawRectangle({ x: 0, y: 240, width: PAGE_W, height: 220, color: MAGENTA });

  let cy = PAGE_H - 170;
  cover.drawText('EBOOK GRATUITO', {
    x: MARGIN,
    y: cy,
    size: 12,
    font: fontBold,
    color: LIME,
  });
  cy -= 44;
  for (const line of wrap(ebook.title || 'Guia', 32, fontBold)) {
    cover.drawText(line, { x: MARGIN, y: cy, size: 32, font: fontBold, color: rgb(1, 1, 1) });
    cy -= 40;
  }
  cy -= 6;
  for (const line of wrap(ebook.subtitle || '', 15, font)) {
    cover.drawText(line, {
      x: MARGIN,
      y: cy,
      size: 15,
      font,
      color: rgb(1, 0.92, 0.96),
    });
    cy -= 21;
  }
  if (ebook.coverTagline) {
    cy -= 14;
    for (const line of wrap(ebook.coverTagline, 12, fontItalic)) {
      cover.drawText(line, { x: MARGIN, y: cy, size: 12, font: fontItalic, color: LIME });
      cy -= 17;
    }
  }
  const clinicLine = clean(`Oferecido por ${clinicName}`);
  cover.drawText(clinicLine, {
    x: PAGE_W / 2 - fontBold.widthOfTextAtSize(clinicLine, 13) / 2,
    y: 88,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // ---------- Páginas internas ----------
  let page = null;
  let y = 0;
  let pageNumber = 1; // capa não conta

  const brand = clean(clinicName);
  const drawFooter = (p, num) => {
    p.drawRectangle({ x: MARGIN, y: FOOTER_Y + 14, width: MAX_W, height: 0.7, color: rgb(0.9, 0.88, 0.9) });
    p.drawText(brand, { x: MARGIN, y: FOOTER_Y, size: 8.5, font: fontBold, color: MAGENTA });
    const label = `${num}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8.5),
      y: FOOTER_Y,
      size: 8.5,
      font,
      color: GRAY,
    });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNumber += 1;
    drawFooter(page, pageNumber - 1);
    y = PAGE_H - MARGIN - 8;
  };

  const ensureSpace = (needed) => {
    if (y - needed < FOOTER_Y + 30) newPage();
  };

  const drawParagraph = (text, { size = 10.5, f = font, color = INK, lineGap = 5.5, maxWidth = MAX_W, x = MARGIN } = {}) => {
    for (const line of wrap(text, size, f, maxWidth)) {
      ensureSpace(size + lineGap);
      page.drawText(line, { x, y, size, font: f, color });
      y -= size + lineGap;
    }
  };

  /** Como drawParagraph, mas renderiza **negrito** de markdown com HelveticaBold. */
  const drawRichParagraph = (text, { size = 10.5, color = INK, lineGap = 5.5, maxWidth = MAX_W, x = MARGIN, baseF = font } = {}) => {
    const { lines, spaceW } = layoutRich(text, size, maxWidth, baseF);
    for (const line of lines) {
      ensureSpace(size + lineGap);
      let cx = x;
      for (const token of line) {
        page.drawText(token.word, { x: cx, y, size, font: token.f, color });
        cx += token.w + spaceW;
      }
      y -= size + lineGap;
    }
  };

  // ---------- Sumário ----------
  newPage();
  page.drawText('Sumário', { x: MARGIN, y, size: 24, font: fontBold, color: MAGENTA });
  y -= 14;
  page.drawRectangle({ x: MARGIN, y, width: 60, height: 4, color: LIME });
  y -= 34;
  sections.forEach((section, idx) => {
    const num = `${String(idx + 1).padStart(2, '0')}`;
    ensureSpace(24);
    page.drawText(num, { x: MARGIN, y, size: 11, font: fontBold, color: MAGENTA });
    const headingLines = wrap(section.heading || '', 11, font, MAX_W - 34);
    page.drawText(headingLines[0] || '', { x: MARGIN + 30, y, size: 11, font, color: INK });
    y -= 24;
  });

  // ---------- Capítulos (fluxo contínuo: sem quebra obrigatória por capítulo) ----------
  const CHAPTER_GAP = 36;
  sections.forEach((section, idx) => {
    const headingLines = wrap(section.heading || '', 17, fontBold, MAX_W - 52);
    // "keep with next": cabeçalho (número + título + barra) + primeiras ~3 linhas do corpo
    const headerH = Math.max(34, headingLines.length * 22) + 34;
    const keepWithNext = 3 * 16.5;

    if (page === null) {
      newPage();
    } else {
      y -= CHAPTER_GAP;
      if (y - (headerH + keepWithNext) < FOOTER_Y + 30) newPage();
    }

    // header do capítulo
    const num = String(idx + 1).padStart(2, '0');
    page.drawText(num, { x: MARGIN, y: y - 6, size: 30, font: fontBold, color: rgb(0.95, 0.82, 0.89) });
    let hy = y - 2;
    for (const line of headingLines) {
      page.drawText(line, { x: MARGIN + 46, y: hy, size: 17, font: fontBold, color: INK });
      hy -= 22;
    }
    y = Math.min(hy, y - 34) - 4;
    page.drawRectangle({ x: MARGIN, y, width: 46, height: 4, color: LIME });
    y -= 26;

    // corpo (com suporte a **negrito** de markdown)
    drawRichParagraph(section.body || '', { size: 10.5, lineGap: 6 });

    // bullets (também com **negrito**)
    const bullets = (section.bullets || []).filter(Boolean);
    if (bullets.length) {
      y -= 6;
      for (const bullet of bullets) {
        const { lines, spaceW } = layoutRich(bullet, 10.5, MAX_W - 18);
        // marcador + primeira linha nunca se separam
        ensureSpace(18 + 16);
        page.drawCircle({ x: MARGIN + 4, y: y + 3.5, size: 2.2, color: MAGENTA });
        for (const line of lines) {
          ensureSpace(16);
          let cx = MARGIN + 14;
          for (const token of line) {
            page.drawText(token.word, { x: cx, y, size: 10.5, font: token.f, color: INK });
            cx += token.w + spaceW;
          }
          y -= 16;
        }
        y -= 2;
      }
    }

    // caixa de dica
    if (section.tip) {
      y -= 10;
      const tipLines = wrap(section.tip, 10, fontItalic, MAX_W - 48);
      const boxH = tipLines.length * 15 + 34;
      ensureSpace(boxH + 10);
      const boxTop = y;
      page.drawRectangle({
        x: MARGIN,
        y: boxTop - boxH,
        width: MAX_W,
        height: boxH,
        color: ROSE_SOFT,
      });
      page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: 4, height: boxH, color: MAGENTA });
      page.drawText('DICA', {
        x: MARGIN + 18,
        y: boxTop - 20,
        size: 9,
        font: fontBold,
        color: MAGENTA,
      });
      let ty = boxTop - 38;
      for (const line of tipLines) {
        page.drawText(line, { x: MARGIN + 18, y: ty, size: 10, font: fontItalic, color: INK });
        ty -= 15;
      }
      y = boxTop - boxH - 8;
    }
  });

  // ---------- Página final (CTA) ----------
  newPage();
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: CREAM });
  drawFooter(page, pageNumber - 1);

  // sorriso suave no fundo
  page.drawCircle({
    x: PAGE_W / 2,
    y: PAGE_H / 2 - 60,
    size: 80,
    borderColor: LIME,
    borderWidth: 12,
  });
  page.drawRectangle({ x: 0, y: PAGE_H / 2 - 60, width: PAGE_W, height: 180, color: CREAM });

  let fy = PAGE_H - 220;
  const ctaTitle = 'Gostou do que leu?';
  page.drawText(ctaTitle, {
    x: PAGE_W / 2 - fontBold.widthOfTextAtSize(ctaTitle, 26) / 2,
    y: fy,
    size: 26,
    font: fontBold,
    color: MAGENTA,
  });
  fy -= 40;
  const ctaLines = wrap(
    `O próximo passo é uma avaliação personalizada com ${clinicName}. ` +
      'Responda a mensagem que você recebeu com este material e agende um horário — sem compromisso.',
    12,
    font,
    MAX_W - 60
  );
  for (const line of ctaLines) {
    page.drawText(line, {
      x: PAGE_W / 2 - font.widthOfTextAtSize(line, 12) / 2,
      y: fy,
      size: 12,
      font,
      color: INK,
    });
    fy -= 19;
  }

  if (ebook.disclaimer) {
    let dy = 110;
    for (const line of wrap(ebook.disclaimer, 8.5, fontItalic, MAX_W - 40)) {
      page.drawText(line, {
        x: PAGE_W / 2 - fontItalic.widthOfTextAtSize(line, 8.5) / 2,
        y: dy,
        size: 8.5,
        font: fontItalic,
        color: GRAY,
      });
      dy -= 13;
    }
  }

  return Buffer.from(await doc.save());
}

module.exports = { buildEbookPdfBuffer };
