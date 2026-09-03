const { DataTypes } = require("sequelize");

// DİKKAT: Bu model, gotur (web) tarafındaki models/systemLogModel.js ile
// BİREBİR aynı kalmalıdır. Her iki uygulama da aynı tenant veritabanına
// `sync({ alter: true })` ile bağlanıyor ve Sequelize v6'da alter, modelde
// bulunmayan kolonları DÜŞÜRÜR. Sadece bir tarafa kolon eklenirse diğer
// uygulama ilk bağlantısında o kolonu siler.
module.exports = (sequelize) => {
  return sequelize.define("systemLog", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    branchId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    module: {
      type: DataTypes.ENUM("transaction", "ticket", "auth", "report", "user"),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    referenceId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    // Koltuk geçmişini tek bir indeksli sorgu ile çıkarabilmek için sefer ve
    // koltuk bilgisi ayrı kolonlarda tutuluyor. Bilet satırı silinse (pending)
    // veya başka bir sefere taşınsa bile o koltuğun geçmişi kaybolmaz.
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    seatNo: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    oldData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    newData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    indexes: [
      { fields: ["tripId", "seatNo"] },
      { fields: ["module", "action"] },
      { fields: ["referenceId"] },
    ],
  });
};
