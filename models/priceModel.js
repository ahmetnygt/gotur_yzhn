const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("price", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    fromStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    toStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    validFrom: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    validUntil: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    seatLimit: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    hourLimit: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    price1: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    price2: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    price3: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    singleSeatPrice1: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    singleSeatPrice2: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    singleSeatPrice3: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    webPrice: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    singleSeatWebPrice: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isBidirectional: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
