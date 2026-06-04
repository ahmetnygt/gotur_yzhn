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
    price: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
  });
};
