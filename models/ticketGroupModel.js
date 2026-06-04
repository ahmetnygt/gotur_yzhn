const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("ticketgroup", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    tripId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  });
};
