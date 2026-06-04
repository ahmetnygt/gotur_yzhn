const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("route", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    routeCode: {
      type: DataTypes.STRING,
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
    reservationOptionTime: {
      type: DataTypes.TIME,
      allowNull: true,
    },
    refundTransferOptionTime: {
      type: DataTypes.TIME,
      allowNull: true,
    },
    maxReservationCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    maxSingleSeatCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
