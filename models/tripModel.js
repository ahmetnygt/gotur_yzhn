const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("trip", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    routeId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    busModelId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    busId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    captainId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    driver2Id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    driver3Id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    assistantId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    hostessId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    reservationOptionDate: {
      type: DataTypes.DATEONLY,
    },
    refundOptionDate: {
      type: DataTypes.DATE,
    },
    date: {
      type: DataTypes.DATEONLY,
    },
    time: {
      type: DataTypes.TIME,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    fromPlaceString: {
      type: DataTypes.STRING,
    },
    toPlaceString: {
      type: DataTypes.STRING,
    },
    busPlanString: {
      type: DataTypes.STRING,
    },
    uetdsRefNo:{
      type: DataTypes.BIGINT,
      allowNull:true
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
