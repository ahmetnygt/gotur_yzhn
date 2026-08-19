const { logSystemEvent, logSystemEvents } = require("../utilities/systemLog");

// Bu dosya daha önce boştu (0 byte) ve routes/erp.js tarafından import edilmesine
// rağmen hiçbir şey yapmıyordu. Artık her isteğe, oturum/tenant bağlamı hazır
// gelmiş şekilde sistem kaydı yazma yardımcılarını bağlıyor:
//
//   await req.logSystem({ module: "ticket", action: "sell", ... })
//   await req.logSystemMany([{ ... }, { ... }])
//
// Yazma işlemi utilities/systemLog.js içinde hata yutacak şekilde sarmalanmıştır;
// log yazılamazsa istek normal şekilde devam eder.
module.exports = (req, res, next) => {
    req.logSystem = (entry, options) => logSystemEvent(req, entry, options);
    req.logSystemMany = (entries, options) => logSystemEvents(req, entries, options);

    next();
};
