const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("routestop", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    routeId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    stopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    order: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    duration: {
      type: DataTypes.TIME,
      allowNull: false,
    },
  });
};
