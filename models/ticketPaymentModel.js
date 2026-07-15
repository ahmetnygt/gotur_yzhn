const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("ticketPayment", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    // TicketPayment ortak (gotur_common) veritabanında yaşıyor ve id'leri
    // TÜM tenant'lar arasında paylaşılan tek bir auto-increment sıra
    // izliyor. tenantKey olmadan bir tenant'ın API key'ine sahip biri başka
    // bir tenant'ın ödeme kaydını (id'yi tahmin ederek/artırarak) görebilir
    // veya tamamlayabilirdi. Artık her sorgu tenantKey ile filtrelenmelidir.
    // NOT: Var olan tablolarda geriye dönük kayıtların tenantKey'i bilinmediği
    // için kolon `allowNull: true` olarak tanımlandı (ALTER TABLE'ın var olan
    // satırlarda patlamaması için); eski kayıtlar ayrı bir migration ile
    // backfill edilmeli. Uygulama kodu her YENİ kayıtta tenantKey'i her zaman
    // set eder (bkz. apiController.createPayment).
    tenantKey: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    fromStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    toStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    seatNumbers: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    genders: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    isSuccess: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
