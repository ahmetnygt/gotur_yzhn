const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("routestoprestriction", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    fromRouteStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    toRouteStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    isAllowed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  });
};
