const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  return sequelize.define("tripstoptime", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    routeStopId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    offsetMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ["tripId", "routeStopId"],
      },
    ],
  });
};
