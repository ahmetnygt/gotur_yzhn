const BASE_COLUMNS = [
    { key: "seatNo", header: "Koltuk", width: 10, type: "string" },
    { key: "fullName", header: "Ad Soyad", width: 24, type: "string" },
    { key: "gender", header: "Cinsiyet", width: 12, type: "string" },
    { key: "nationality", header: "Uyruk", width: 18, type: "string" },
    { key: "from", header: "Nereden", width: 18, type: "string" },
    { key: "to", header: "Nereye", width: 18, type: "string" },
    { key: "phoneNumber", header: "Telefon", width: 16, type: "string" },
    { key: "idNumber", header: "Kimlik No", width: 16, type: "string" },
    { key: "pnr", header: "PNR", width: 14, type: "string" },
];

const OPTIONAL_COLUMNS = [
    { key: "takeOn", header: "Yolda Biniş", width: 22, type: "string" },
    { key: "takeOff", header: "Yolda İniş", width: 22, type: "string" },
];

const STOP_COLUMN = { key: "isCurrentStop", header: "Bu Durak", width: 12, type: "string" };

function hasColumnValue(rows, key) {
    return (rows || []).some(row => {
        const value = row?.[key];
        return value !== null && value !== undefined && String(value).trim() !== "";
    });
}

function columnsForRows(rows) {
    const columns = [...BASE_COLUMNS];
    OPTIONAL_COLUMNS.forEach(column => {
        if (hasColumnValue(rows, column.key)) {
            columns.push(column);
        }
    });
    columns.push(STOP_COLUMN);
    return columns;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
        table[i] = crc >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUInt16LE(target, offset, value) {
    target[offset] = value & 0xFF;
    target[offset + 1] = (value >>> 8) & 0xFF;
}

function writeUInt32LE(target, offset, value) {
    target[offset] = value & 0xFF;
    target[offset + 1] = (value >>> 8) & 0xFF;
    target[offset + 2] = (value >>> 16) & 0xFF;
    target[offset + 3] = (value >>> 24) & 0xFF;
}

function createZip(files) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    files.forEach(file => {
        const nameBuffer = Buffer.from(file.name, "utf8");
        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
        const crc = crc32(data);

        const local = Buffer.alloc(30 + nameBuffer.length + data.length);
        writeUInt32LE(local, 0, 0x04034b50);
        writeUInt16LE(local, 4, 20);
        writeUInt16LE(local, 6, 0);
        writeUInt16LE(local, 8, 0);
        writeUInt16LE(local, 10, 0);
        writeUInt16LE(local, 12, 0);
        writeUInt32LE(local, 14, crc);
        writeUInt32LE(local, 18, data.length);
        writeUInt32LE(local, 22, data.length);
        writeUInt16LE(local, 26, nameBuffer.length);
        writeUInt16LE(local, 28, 0);
        nameBuffer.copy(local, 30);
        data.copy(local, 30 + nameBuffer.length);
        localChunks.push(local);

        const central = Buffer.alloc(46 + nameBuffer.length);
        writeUInt32LE(central, 0, 0x02014b50);
        writeUInt16LE(central, 4, 20);
        writeUInt16LE(central, 6, 20);
        writeUInt16LE(central, 8, 0);
        writeUInt16LE(central, 10, 0);
        writeUInt16LE(central, 12, 0);
        writeUInt16LE(central, 14, 0);
        writeUInt32LE(central, 16, crc);
        writeUInt32LE(central, 20, data.length);
        writeUInt32LE(central, 24, data.length);
        writeUInt16LE(central, 28, nameBuffer.length);
        writeUInt16LE(central, 30, 0);
        writeUInt16LE(central, 32, 0);
        writeUInt16LE(central, 34, 0);
        writeUInt16LE(central, 36, 0);
        writeUInt32LE(central, 38, 0);
        writeUInt32LE(central, 42, offset);
        nameBuffer.copy(central, 46);
        centralChunks.push(central);

        offset += local.length;
    });

    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const eocd = Buffer.alloc(22);
    writeUInt32LE(eocd, 0, 0x06054b50);
    writeUInt16LE(eocd, 4, 0);
    writeUInt16LE(eocd, 6, 0);
    writeUInt16LE(eocd, 8, files.length);
    writeUInt16LE(eocd, 10, files.length);
    writeUInt32LE(eocd, 12, centralSize);
    writeUInt32LE(eocd, 16, offset);
    writeUInt16LE(eocd, 20, 0);

    return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

function escapeXml(value) {
    return String(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function colLetter(index) {
    let n = index + 1;
    let result = "";
    while (n > 0) {
        const remainder = (n - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        n = Math.floor((n - 1) / 26);
    }
    return result;
}

function sanitizeSheetName(name) {
    const cleaned = String(name || "Sayfa")
        .replace(/[:\\/?*\[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 31);
    return cleaned || "Sayfa";
}

function cellXml(ref, value, type, styleId) {
    if (type === "number") {
        const amount = Number(value);
        if (!Number.isFinite(amount)) {
            return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t></t></is></c>`;
        }
        return `<c r="${ref}" s="${styleId}" t="n"><v>${amount}</v></c>`;
    }

    const text = value === null || value === undefined ? "" : String(value);
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
}

function buildWorksheet(title, rows) {
    const columns = columnsForRows(rows);
    const lastCol = colLetter(columns.length - 1);
    const headerRow = 2;
    const firstDataRow = 3;
    const lastDataRow = Math.max(headerRow, firstDataRow + rows.length - 1);

    const colsXml = columns.map((column, index) => (
        `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`
    )).join("");

    const titleCells = columns.map((_, index) => {
        const ref = `${colLetter(index)}1`;
        if (index === 0) {
            return cellXml(ref, title || "Yolcu Listesi", "string", 3);
        }
        return `<c r="${ref}" s="3"/>`;
    }).join("");

    const headerCells = columns.map((column, index) => (
        cellXml(`${colLetter(index)}${headerRow}`, column.header, "string", 1)
    )).join("");

    const dataRowsXml = rows.map((row, rowIndex) => {
        const excelRow = firstDataRow + rowIndex;
        const cells = columns.map((column, colIndex) => {
            const styleId = column.type === "number" ? 2 : 0;
            return cellXml(`${colLetter(colIndex)}${excelRow}`, row[column.key], column.type, styleId);
        }).join("");
        return `<row r="${excelRow}">${cells}</row>`;
    }).join("");

    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheetViews><sheetView workbookViewId="0">` +
        `<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A3" sqref="A3"/>` +
        `</sheetView></sheetViews>` +
        `<cols>${colsXml}</cols>` +
        `<sheetData>` +
        `<row r="1">${titleCells}</row>` +
        `<row r="${headerRow}">${headerCells}</row>` +
        dataRowsXml +
        `</sheetData>` +
        `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>` +
        `<mergeCells count="1"><mergeCell ref="A1:${lastCol}1"/></mergeCells>` +
        `</worksheet>`
    );
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="12"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

function generateTripPassengersExcel({ title, sheets }) {
    const usedNames = new Set();
    const safeSheets = (Array.isArray(sheets) ? sheets : []).map((sheet, index) => {
        let name = sanitizeSheetName(sheet.name || `Sayfa ${index + 1}`);
        let suffix = 1;
        while (usedNames.has(name.toLowerCase())) {
            const base = sanitizeSheetName((sheet.name || `Sayfa ${index + 1}`).slice(0, 28));
            name = sanitizeSheetName(`${base} ${suffix}`);
            suffix += 1;
        }
        usedNames.add(name.toLowerCase());
        return {
            name,
            xml: buildWorksheet(title, Array.isArray(sheet.rows) ? sheet.rows : []),
        };
    });

    if (!safeSheets.length) {
        safeSheets.push({
            name: "Yolcular",
            xml: buildWorksheet(title, []),
        });
    }

    const workbookSheets = safeSheets.map((sheet, index) => (
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )).join("");

    const workbookXml = (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${workbookSheets}</sheets>` +
        `</workbook>`
    );

    const workbookRels = (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        safeSheets.map((_, index) => (
            `<Relationship Id="rId${index + 1}" ` +
            `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
            `Target="worksheets/sheet${index + 1}.xml"/>`
        )).join("") +
        `<Relationship Id="rId${safeSheets.length + 1}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ` +
        `Target="styles.xml"/>` +
        `</Relationships>`
    );

    const contentTypes = (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        safeSheets.map((_, index) => (
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
            `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )).join("") +
        `</Types>`
    );

    const rootRels = (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    );

    const files = [
        { name: "[Content_Types].xml", data: contentTypes },
        { name: "_rels/.rels", data: rootRels },
        { name: "xl/workbook.xml", data: workbookXml },
        { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
        { name: "xl/styles.xml", data: STYLES_XML },
        ...safeSheets.map((sheet, index) => ({
            name: `xl/worksheets/sheet${index + 1}.xml`,
            data: sheet.xml,
        })),
    ];

    return createZip(files);
}

module.exports = generateTripPassengersExcel;
