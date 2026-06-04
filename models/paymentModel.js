const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("payment", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    initiatorId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    payerId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    receiverId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    cash_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    card_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      defaultValue: "pending",
      allowNull: false,
    },
    isWholeTransfer: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
  });
};
