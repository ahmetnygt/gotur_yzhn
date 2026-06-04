const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("busmodel", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    planBinary: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    plan: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    maxPassenger: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    rowCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    colCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};