type CsvCell = string | number | null | undefined | false;

/** Spreadsheets run a cell that starts with one of these as a formula. */
const startsFormula = /^[=+\-@\t\r]/;
const isNumber = /^-?\d+(\.\d+)?$/;

function csvCell(value: CsvCell): string {
  const text = value === 0 ? "0" : String(value || "");
  const safe = startsFormula.test(text) && !isNumber.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Rows as CSV text. It opens with a byte order mark, because without one Excel and Google Sheets
 * read the file as Latin-1 and turn "Gráinne" into "GrÃ¡inne".
 */
export const toCsv = (rows: CsvCell[][]): string =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
