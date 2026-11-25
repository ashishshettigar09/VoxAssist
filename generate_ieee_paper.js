/**
 * Enhanced IEEE Conference Paper Formatting Engine (Node.js docx)
 * Strictly follows IEEE_Conference_Template__6_/conference_101719.pdf specifications:
 * - Page size: US Letter (8.5 x 11 in)
 * - Margins: Top 0.75 in (1080 dxa), Bottom 1.0 in (1440 dxa), Left/Right 0.625 in (900 dxa)
 * - Section 1: Single-Column Title + 3-Column Author Affiliation Block
 * - Section 2: Continuous Two-Column Layout (0.25 in gutter / 360 dxa) starting directly at Abstract & Index Terms
 * - Times New Roman typography across all elements
 * - Generously padded Figure Placeholders with physical canvas height for diagram insertion
 * - IEEE open-sided horizontal-rule Tables with captions ABOVE table & superscript footnotes BELOW
 * - Numbered borderless Equation tables right-aligned (1), (2), ...
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  SectionType,
  ShadingType,
  HeightRule,
  VerticalAlign
} = require('docx');

const FONT_NAME = 'Times New Roman';
const TITLE_SIZE = 44;      // 22 pt (close to 24pt standard conference title, prevents awkward wraps)
const SUB_SIZE = 18;        // 9 pt
const AUTHOR_SIZE = 20;     // 10 pt
const AFFIL_SIZE = 18;      // 9 pt
const ABS_SIZE = 18;        // 9 pt (IEEE conference standard for Abstract & Index Terms)
const BODY_SIZE = 20;       // 10 pt (IEEE standard body text)
const HEADING1_SIZE = 20;   // 10 pt
const HEADING2_SIZE = 20;   // 10 pt
const CAPTION_SIZE = 16;    // 8 pt (IEEE standard captions & table text)
const REF_SIZE = 16;        // 8 pt (IEEE conference standard references)

function createTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 140, line: 260 },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: TITLE_SIZE,
        bold: false
      })
    ]
  });
}

function createAuthorBlock(authorsList) {
  // 3-column balanced author grid matching conference_101719.pdf
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE }
    },
    rows: [
      new TableRow({
        children: authorsList.map(author => new TableCell({
          width: { size: Math.floor(100 / authorsList.length), type: WidthType.PERCENTAGE },
          margins: { top: 40, bottom: 120, left: 60, right: 60 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 20, line: 210 },
              children: [
                new TextRun({ text: author.name + '\n', font: FONT_NAME, size: AUTHOR_SIZE }),
                new TextRun({ text: author.dept + '\n', font: FONT_NAME, size: AFFIL_SIZE, italics: true }),
                new TextRun({ text: author.org + '\n', font: FONT_NAME, size: AFFIL_SIZE, italics: true }),
                new TextRun({ text: author.city + '\n', font: FONT_NAME, size: AFFIL_SIZE }),
                new TextRun({ text: author.email, font: FONT_NAME, size: 17 })
              ]
            })
          ]
        }))
      })
    ]
  });
  return table;
}

function createAbstractInColumn(abstractText, indexTerms) {
  return [
    new Paragraph({
      alignment: AlignmentType.JUSTIFY,
      spacing: { before: 40, after: 100, line: 205 },
      children: [
        new TextRun({ text: 'Abstract—', font: FONT_NAME, size: ABS_SIZE, bold: true, italics: true }),
        new TextRun({ text: abstractText, font: FONT_NAME, size: ABS_SIZE, bold: true })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFY,
      spacing: { before: 40, after: 160, line: 205 },
      children: [
        new TextRun({ text: 'Index Terms—', font: FONT_NAME, size: ABS_SIZE, bold: true, italics: true }),
        new TextRun({ text: indexTerms, font: FONT_NAME, size: ABS_SIZE, bold: true })
      ]
    })
  ];
}

function p(text, indent = true, spacingAfter = 80) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: indent ? { firstLine: 200 } : undefined, // ~0.14 in IEEE column paragraph indent
    spacing: { after: spacingAfter, line: 230 },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: BODY_SIZE
      })
    ]
  });
}

function pRich(runsList, indent = true, spacingAfter = 80) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: indent ? { firstLine: 200 } : undefined,
    spacing: { after: spacingAfter, line: 230 },
    children: runsList.map(r => new TextRun({
      text: r.text,
      font: FONT_NAME,
      size: BODY_SIZE,
      bold: !!r.bold,
      italics: !!r.italics
    }))
  });
}

function secHeading(romanNum, title) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { before: 200, after: 80, line: 220 },
    children: [
      new TextRun({
        text: romanNum ? `${romanNum}.  ${title.toUpperCase()}` : title.toUpperCase(),
        font: FONT_NAME,
        size: HEADING1_SIZE,
        bold: false,
        smallCaps: true
      })
    ]
  });
}

function subHeading(letter, title) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    keepNext: true,
    spacing: { before: 140, after: 60, line: 220 },
    children: [
      new TextRun({
        text: `${letter}.  ${title}`,
        font: FONT_NAME,
        size: HEADING2_SIZE,
        italics: true,
        bold: false
      })
    ]
  });
}

function subSubHeading(numStr, title, inlineText) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: { firstLine: 200 },
    spacing: { before: 60, after: 70, line: 230 },
    children: [
      new TextRun({ text: `${numStr} ${title}: `, font: FONT_NAME, size: BODY_SIZE, italics: true }),
      new TextRun({ text: inlineText, font: FONT_NAME, size: BODY_SIZE })
    ]
  });
}

function eq(formulaText, eqNum) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE }
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 86, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 50, after: 50 },
                children: [
                  new TextRun({ text: formulaText, font: FONT_NAME, size: BODY_SIZE, italics: true })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 14, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 50, after: 50 },
                children: [
                  new TextRun({ text: `(${eqNum})`, font: FONT_NAME, size: BODY_SIZE })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

function figPlaceholder(figNum, title, description, heightDxa = 2600) {
  // Generous blank canvas (approx 1.8 inches default height) ready to drop images/flowcharts cleanly
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.DASHED, size: 6, color: '64748B' },
        bottom: { style: BorderStyle.DASHED, size: 6, color: '64748B' },
        left: { style: BorderStyle.DASHED, size: 6, color: '64748B' },
        right: { style: BorderStyle.DASHED, size: 6, color: '64748B' }
      },
      rows: [
        new TableRow({
          height: { value: heightDxa, rule: HeightRule.ATLEAST },
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 140, bottom: 140, left: 140, right: 140 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 40, after: 60 },
                  children: [
                    new TextRun({
                      text: `[ SPACE RESERVED FOR FIGURE ${figNum} ]`,
                      font: FONT_NAME,
                      size: 18,
                      bold: true,
                      color: '334155'
                    })
                  ]
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 20, after: 40, line: 200 },
                  children: [
                    new TextRun({
                      text: `Recommended Graphic: 300 DPI Vector/PNG Diagram (Column-Width ~3.4 in)\n${description}`,
                      font: FONT_NAME,
                      size: CAPTION_SIZE,
                      italics: true,
                      color: '64748B'
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFY,
      spacing: { before: 60, after: 140, line: 195 },
      children: [
        new TextRun({ text: `Fig. ${figNum}.  `, font: FONT_NAME, size: CAPTION_SIZE, bold: true }),
        new TextRun({ text: `${title} ${description}`, font: FONT_NAME, size: CAPTION_SIZE })
      ]
    })
  ];
}

function tableElement(tableNum, tableTitle, headers, rowsData, footnote = '', colWidthsPct = null) {
  const colCount = headers.length;
  const pcts = colWidthsPct || headers.map(() => Math.floor(100 / colCount));
  const tableRows = [];

  // Header row (IEEE double top or solid top rule + header bottom rule, no left/right vertical borders)
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: headers.map((h, i) => new TableCell({
        width: { size: pcts[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 20, after: 20, line: 185 },
            children: [
              new TextRun({ text: h, font: FONT_NAME, size: 15, bold: true })
            ]
          })
        ]
      }))
    })
  );

  // Data rows
  rowsData.forEach((row, rIdx) => {
    const isLast = rIdx === rowsData.length - 1;
    const isHighlight = row._highlight === true;
    const cellsText = Array.isArray(row) ? row : row.cells;

    tableRows.push(
      new TableRow({
        children: cellsText.map((cellText, cIdx) => new TableCell({
          width: { size: pcts[cIdx], type: WidthType.PERCENTAGE },
          shading: isHighlight ? { type: ShadingType.CLEAR, fill: 'EFF6FF' } : undefined,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 35, bottom: 35, left: 50, right: 50 },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: isLast
              ? { style: BorderStyle.SINGLE, size: 8, color: '000000' }
              : { style: BorderStyle.SINGLE, size: 2, color: 'CBD5E1' },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE }
          },
          children: [
            new Paragraph({
              alignment: cIdx === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
              spacing: { before: 15, after: 15, line: 185 },
              children: [
                new TextRun({
                  text: String(cellText),
                  font: FONT_NAME,
                  size: 15,
                  bold: cIdx === 0 || isHighlight
                })
              ]
            })
          ]
        }))
      })
    );
  });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 140, after: 30, line: 190 },
      children: [
        new TextRun({ text: `TABLE ${tableNum}\n`, font: FONT_NAME, size: CAPTION_SIZE, bold: false }),
        new TextRun({ text: tableTitle.toUpperCase(), font: FONT_NAME, size: CAPTION_SIZE, smallCaps: true })
      ]
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows
    })
  ];

  if (footnote) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFY,
        spacing: { before: 40, after: 120, line: 185 },
        children: [
          new TextRun({ text: footnote, font: FONT_NAME, size: 14, italics: true, color: '475569' })
        ]
      })
    );
  } else {
    children.push(new Paragraph({ spacing: { before: 20, after: 100 } }));
  }

  return children;
}

function refItem(num, text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: { left: 260, hanging: 260 },
    spacing: { after: 50, line: 190 },
    children: [
      new TextRun({ text: `[${num}]\t`, font: FONT_NAME, size: REF_SIZE }),
      new TextRun({ text, font: FONT_NAME, size: REF_SIZE })
    ]
  });
}

module.exports = {
  createTitle,
  createAuthorBlock,
  createAbstractInColumn,
  p,
  pRich,
  secHeading,
  subHeading,
  subSubHeading,
  eq,
  figPlaceholder,
  tableElement,
  refItem,
  Document,
  Packer,
  SectionType
};
