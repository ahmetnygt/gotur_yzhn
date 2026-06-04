const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("cashRegister", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    cash_balance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    card_balance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    reset_date_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });
};
