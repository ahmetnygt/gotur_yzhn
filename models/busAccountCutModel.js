const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("busaccountcut", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    stopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    // NOT: Parametresiz DECIMAL, MySQL'de DECIMAL(10,0)'a denk gelir; yani
    // kuruş/ondalık hane TAMAMEN kesilir (örn. 123.45 -> 123). Tüm para
    // alanları artık açıkça DECIMAL(12,2) olarak tanımlanıyor.
    comissionPercent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
    },
    comissionAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    deduction1: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    deduction2: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    deduction3: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    deduction4: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    deduction5: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    tip: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    needToPayAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    payedAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
  });
};
