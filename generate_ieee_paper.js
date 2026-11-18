/**
 * Generator script for VoxAssist IEEE Research Paper
 * Produces an authentic, highly rigorous, professional, and humanized
 * IEEE Conference/Journal formatted Word Document (.docx) exceeding 6 pages.
 * Strictly adheres to justified text alignment and clean Unicode mathematical typography.
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
  ShadingType
} = require('docx');
const fs = require('fs');

// Helpers for IEEE Document Styling
const FONT_NAME = 'Times New Roman';
const BODY_SIZE = 20; // 10 pt in half-points
const TITLE_SIZE = 44; // 22 pt
const SUBTITLE_SIZE = 24; // 12 pt
const AUTHOR_SIZE = 20; // 10 pt
const AFFIL_SIZE = 18; // 9 pt
const HEADING1_SIZE = 20; // 10 pt
const HEADING2_SIZE = 20; // 10 pt
const CAPTION_SIZE = 17; // 8.5 pt
const TABLE_TEXT_SIZE = 17; // 8.5 pt

function createTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 160 },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: TITLE_SIZE,
        bold: true
      })
    ]
  });
}

function createAuthorBlock() {
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
        children: [
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Ashish Shettigar', font: FONT_NAME, size: AUTHOR_SIZE, bold: true }),
                  new TextRun({ text: '\nDept. of Electronics & Comm. Engg.', font: FONT_NAME, size: AFFIL_SIZE }),
                  new TextRun({ text: '\nIoT & Embedded Assistive Systems Lab', font: FONT_NAME, size: AFFIL_SIZE, italics: true }),
                  new TextRun({ text: '\nashish.shettigar@example.edu', font: FONT_NAME, size: AFFIL_SIZE })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 34, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Research Collaborator', font: FONT_NAME, size: AUTHOR_SIZE, bold: true }),
                  new TextRun({ text: '\nDept. of Computer Science & Engg.', font: FONT_NAME, size: AFFIL_SIZE }),
                  new TextRun({ text: '\nHuman-Computer Interaction Group', font: FONT_NAME, size: AFFIL_SIZE, italics: true }),
                  new TextRun({ text: '\ncollaborator@example.edu', font: FONT_NAME, size: AFFIL_SIZE })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Principal Investigator', font: FONT_NAME, size: AUTHOR_SIZE, bold: true }),
                  new TextRun({ text: '\nCenter for Assistive Technologies', font: FONT_NAME, size: AFFIL_SIZE }),
                  new TextRun({ text: '\nSchool of Electrical Engineering', font: FONT_NAME, size: AFFIL_SIZE, italics: true }),
                  new TextRun({ text: '\npi.investigator@example.edu', font: FONT_NAME, size: AFFIL_SIZE })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
  return table;
}

function createAbstract(abstractText, indexTerms) {
  return [
    new Paragraph({
      alignment: AlignmentType.JUSTIFY,
      spacing: { before: 160, after: 80 },
      children: [
        new TextRun({ text: 'Abstract—', font: FONT_NAME, size: BODY_SIZE, bold: true, italics: true }),
        new TextRun({ text: abstractText, font: FONT_NAME, size: BODY_SIZE, italics: true })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFY,
      spacing: { before: 40, after: 180 },
      children: [
        new TextRun({ text: 'Index Terms—', font: FONT_NAME, size: BODY_SIZE, bold: true, italics: true }),
        new TextRun({ text: indexTerms, font: FONT_NAME, size: BODY_SIZE })
      ]
    })
  ];
}

function p(text, indent = true, spacingAfter = 100) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: indent ? { firstLine: 240 } : undefined, // 0.17 inch paragraph indent
    spacing: { after: spacingAfter, line: 240 }, // Standard line spacing
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: BODY_SIZE
      })
    ]
  });
}

function secHeading(romanNum, title) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 100 },
    children: [
      new TextRun({
        text: romanNum ? `${romanNum}.  ${title.toUpperCase()}` : title.toUpperCase(),
        font: FONT_NAME,
        size: HEADING1_SIZE,
        bold: true
      })
    ]
  });
}

function subHeading(letter, title) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    spacing: { before: 160, after: 60 },
    children: [
      new TextRun({
        text: `${letter}.  ${title}`,
        font: FONT_NAME,
        size: HEADING2_SIZE,
        italics: true,
        bold: true
      })
    ]
  });
}

function subSubHeading(numStr, title) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    spacing: { before: 120, after: 40 },
    indent: { left: 160 },
    children: [
      new TextRun({
        text: `${numStr} ${title}: `,
        font: FONT_NAME,
        size: BODY_SIZE,
        italics: true
      })
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
            width: { size: 88, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({ text: formulaText, font: FONT_NAME, size: BODY_SIZE, italics: true })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 12, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 60, after: 60 },
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

function figPlaceholder(figNum, title, description) {
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.DASHED, size: 2, color: '64748B' },
        bottom: { style: BorderStyle.DASHED, size: 2, color: '64748B' },
        left: { style: BorderStyle.DASHED, size: 2, color: '64748B' },
        right: { style: BorderStyle.DASHED, size: 2, color: '64748B' }
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
              margins: { top: 200, bottom: 200, left: 160, right: 160 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 80, after: 40 },
                  children: [
                    new TextRun({
                      text: `[ INSERT FIGURE ${figNum} HERE ]`,
                      font: FONT_NAME,
                      size: BODY_SIZE,
                      bold: true,
                      color: '1E293B'
                    })
                  ]
                }),
                new Paragraph({
                  alignment: AlignmentType.JUSTIFY,
                  spacing: { before: 40, after: 80 },
                  children: [
                    new TextRun({
                      text: `(Space reserved for diagram insertion. Dimensions: Column-width or Full-width. Vector / high-resolution 300 DPI recommended.)\n${description}`,
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
      spacing: { before: 60, after: 160 },
      children: [
        new TextRun({ text: `Fig. ${figNum}.  `, font: FONT_NAME, size: CAPTION_SIZE, bold: true }),
        new TextRun({ text: `${title}. ${description}`, font: FONT_NAME, size: CAPTION_SIZE })
      ]
    })
  ];
}

function tableElement(tableNum, tableTitle, headers, rowsData, footnote = '') {
  const tableRows = [];

  // Header row
  tableRows.push(
    new TableRow({
      children: headers.map(h => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
          bottom: { style: BorderStyle.SINGLE, size: 3, color: '000000' },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60 },
            children: [
              new TextRun({ text: h, font: FONT_NAME, size: TABLE_TEXT_SIZE, bold: true })
            ]
          })
        ]
      }))
    })
  );

  // Data rows
  rowsData.forEach((row, rIdx) => {
    const isLast = rIdx === rowsData.length - 1;
    tableRows.push(
      new TableRow({
        children: row.map(cellText => new TableCell({
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: isLast ? { style: BorderStyle.SINGLE, size: 4, color: '000000' } : { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE }
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 40 },
              children: [
                new TextRun({ text: cellText, font: FONT_NAME, size: TABLE_TEXT_SIZE })
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
      spacing: { before: 180, after: 20 },
      children: [
        new TextRun({ text: `TABLE ${tableNum}\n`, font: FONT_NAME, size: CAPTION_SIZE, bold: true }),
        new TextRun({ text: tableTitle.toUpperCase(), font: FONT_NAME, size: CAPTION_SIZE })
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
        spacing: { before: 40, after: 120 },
        children: [
          new TextRun({ text: footnote, font: FONT_NAME, size: 16, italics: true, color: '475569' })
        ]
      })
    );
  }

  return children;
}

function refItem(num, text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFY,
    indent: { left: 280, hanging: 280 },
    spacing: { after: 60, line: 220 },
    children: [
      new TextRun({ text: `[${num}]\t`, font: FONT_NAME, size: 18 }),
      new TextRun({ text, font: FONT_NAME, size: 18 })
    ]
  });
}

console.log("Compiling paper structure...");

module.exports = {
  createTitle,
  createAuthorBlock,
  createAbstract,
  p,
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
