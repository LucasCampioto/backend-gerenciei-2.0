const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { buildEbookPdfBuffer } = require('./ebookPdf.service');

const shortSection = (i) => ({
  heading: `Capítulo curto ${i}`,
  body: 'Um parágrafo curto com poucas linhas de conteúdo para o teste de ocupação.',
  bullets: ['Item um', 'Item dois'],
  tip: '',
});

const longSection = (i) => ({
  heading: `Capítulo longo ${i} sobre um tema bastante específico`,
  body: 'Frase útil e específica sobre o tema, com detalhes práticos e exemplos do dia a dia. '.repeat(20),
  bullets: ['MITO: algo comum', 'VERDADE: a explicação real', 'Checklist item', 'Outro item prático'],
  tip: 'Uma dica de ouro prática para aplicar antes da avaliação.',
});

async function pageCount(buffer) {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

test('capítulos curtos compartilham páginas (sem página quase vazia por capítulo)', async () => {
  const ebook = {
    title: 'Guia de teste',
    subtitle: 'Subtítulo',
    coverTagline: 'Tagline',
    sections: Array.from({ length: 6 }, (_, i) => shortSection(i + 1)),
    disclaimer: 'Conteúdo educativo.',
  };
  const buffer = await buildEbookPdfBuffer(ebook, { clinicName: 'Clínica Teste' });
  const pages = await pageCount(buffer);
  // fluxo antigo: capa + sumário + 6 páginas (1 por capítulo) + CTA = 9
  // fluxo contínuo: os 6 capítulos curtos cabem em ~2 páginas internas
  assert.ok(pages <= 6, `esperava no máximo 6 páginas, veio ${pages}`);
});

test('capítulos longos fluem por várias páginas sem erro', async () => {
  const ebook = {
    title: 'Guia longo de teste',
    subtitle: 'Subtítulo',
    sections: Array.from({ length: 10 }, (_, i) => longSection(i + 1)),
    disclaimer: 'Conteúdo educativo.',
  };
  const buffer = await buildEbookPdfBuffer(ebook, { clinicName: 'Clínica Teste' });
  const pages = await pageCount(buffer);
  assert.ok(pages >= 8, `eBook longo deveria ter várias páginas, veio ${pages}`);
});

test('corpo e bullets com **negrito** de markdown geram PDF válido', async () => {
  const ebook = {
    title: 'Guia com **markdown** no título',
    subtitle: 'Sub com **destaque**',
    sections: [
      {
        heading: 'Mitos e verdades',
        body:
          'Vamos esclarecer: **MITO:** o preenchimento deixa artificial. **VERDADE:** com técnica adequada o resultado é natural. '.repeat(
            5
          ),
        bullets: [
          '**MITO:** os efeitos são permanentes. **VERDADE:** duram de 6 meses a 1 ano.',
          '**MITO:** é muito doloroso. **VERDADE:** com anestesia o desconforto é mínimo.',
        ],
        tip: 'Dica com **negrito** também.',
      },
    ],
    disclaimer: 'Conteúdo educativo.',
  };
  const buffer = await buildEbookPdfBuffer(ebook, { clinicName: 'Clínica Teste' });
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('mistura de capítulos curtos e longos gera PDF válido', async () => {
  const ebook = {
    title: 'Guia misto',
    sections: [shortSection(1), longSection(2), shortSection(3), shortSection(4), longSection(5)],
  };
  const buffer = await buildEbookPdfBuffer(ebook, { clinicName: 'Clínica Teste' });
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});
