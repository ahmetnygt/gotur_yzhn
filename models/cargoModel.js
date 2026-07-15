const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("cargo", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
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
    senderName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    senderPhone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    senderIdentity: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    payment: {
      type: DataTypes.ENUM("cash", "card"),
      allowNull: false,
    },
    // Parametresiz DECIMAL, MySQL'de DECIMAL(10,0)'a denk gelir ve ondalık
    // haneleri (kuruşu) tamamen keser; bu yüzden açıkça DECIMAL(12,2) kullanılıyor.
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
  });
};
