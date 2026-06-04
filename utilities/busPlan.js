const PDFDocument = require('pdfkit');
const fs = require('fs');

/**
 * 16x5 koltuk gridini sayfanın kullanılabilir enine tam oturtur.
 * - seatWidth = (availableWidth - gap*(cols-1)) / cols
 * - Yazı boyutları seatWidth'e göre ölçeklenir.
 */
function generateBusPlanPDF(busModel, tickets = {}, outputPath) {
    const doc = new PDFDocument({ size: 'A4', margin: 40 }); // tek değer -> tüm kenarlar
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const cols = 5;
    const rows = 16;

    // Sayfanın kullanılabilir eni (kenar boşlukları düşülmüş)
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Koltuklar arası boşluk (gap) ve genişlik dinamik:
    // Gap'i sabit tutup seatWidth'i enin tamamını dolduracak şekilde hesaplıyoruz.
    const gap = 10; // istersen 6-12 arası deneyebilirsin
    const seatWidth = (availableWidth - gap * (cols - 1)) / cols;

    // Yüksekliği en-boy oranını korumak için kare yapıyoruz (istersen farklılaştır)
    const seatHeight = seatWidth;

    // Sol üst başlangıç koordinatları: sol marjı referans al
    const startX = doc.page.margins.left;
    const startY = doc.page.margins.top;

    // Yazı boyutlarını kutu boyuna göre ölçekle
    const fontSeatNo = Math.max(7, Math.floor(seatWidth * 0.27));   // koltuk numarası
    const fontName = Math.max(6, Math.floor(seatWidth * 0.22));   // isim
    const fontLeg = Math.max(5, Math.floor(seatWidth * 0.18));   // from-to

    let seatIndex = 0;
    let seatNumber = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const hasSeat = busModel.planBinary?.[seatIndex] != 0;
            if (hasSeat) {
                seatNumber++;
                const x = startX + c * (seatWidth + gap);
                const y = startY + r * (seatHeight + gap);

                // Koltuk kutusu
                doc.rect(x, y, seatWidth, seatHeight).stroke();

                // Koltuk numarası (sol üst)
                doc.fontSize(fontSeatNo).text(String(seatNumber), x + 2, y + 2, {
                    width: seatWidth - 4,
                    height: seatHeight - 4
                });

                // Bilet bilgisi
                const ticket = tickets[seatNumber];
                if (ticket) {
                    // İsim
                    doc.fontSize(fontName).text(ticket.name || '', x + 2, y + seatHeight * 0.40, {
                        width: seatWidth - 4,
                        height: seatHeight * 0.25,
                    });

                    // Rota kısaltması (from-to)
                    if (ticket.from || ticket.to) {
                        doc.fontSize(fontLeg).text(
                            `${ticket.from || ''}-${ticket.to || ''}`,
                            x + 2,
                            y + seatHeight * 0.70,
                            { width: seatWidth - 4 }
                        );
                    }
                }
            }
            seatIndex++;
        }
    }

    doc.end();
    stream.on('finish', () => console.log(`PDF oluşturuldu -> ${outputPath}`));
}

if (require.main === module) {
    const samplePlanBinary = Array.from({ length: 80 }, (_, i) => [1, 1, 0, 1, 1][i % 5]); // 16x5
    const sampleModel = { planBinary: samplePlanBinary };
    const sampleTickets = {
        1: { name: 'Ali Veli', from: 'ANK', to: 'IST' },
        2: { name: 'Ayşe Fatma', from: 'ANK', to: 'IST' },
        10: { name: 'Mehmet', from: 'ANK', to: 'IZM' }
    };
    generateBusPlanPDF(sampleModel, sampleTickets, 'busPlan.pdf');
    console.log('busPlan.pdf created');
}

module.exports = generateBusPlanPDF;