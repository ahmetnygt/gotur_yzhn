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
    comissionPercent: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    comissionAmount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    deduction1: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    deduction2: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    deduction3: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    deduction4: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    deduction5: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    tip: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    needToPayAmount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    payedAmount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
  });
};
