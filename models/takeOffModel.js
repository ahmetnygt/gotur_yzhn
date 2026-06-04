const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("takeOff", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });
};
