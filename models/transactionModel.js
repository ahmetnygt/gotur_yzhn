const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("transaction", {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("income", "expense"),
      allowNull: false,
    },
    category: {
      type: DataTypes.ENUM(
        "point_sale",
        "cash_sale",
        "card_sale",
        "cash_refund",
        "card_refund",
        "payed_to_bus",
        "income",
        "expense",
        "transfer_in",
        "transfer_out",
        "register_reset"
      ),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
    },
    ticketId: {
      type: DataTypes.BIGINT,
    },
  });
};
