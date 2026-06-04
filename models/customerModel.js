const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("customer", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    idNumber: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    surname: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    gender: {
      type: DataTypes.ENUM("m", "f"),
      allowNull: false,
    },
    nationality: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    customerType: {
      type: DataTypes.ENUM("adult", "child", "student", "disabled", "retired"),
      allowNull: false,
    },
    customerCategory: {
      type: DataTypes.ENUM("normal", "member"),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    pointOrPercent: {
      type: DataTypes.ENUM("point", "percent"),
    },
    point_amount: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    percent: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    isBlackList: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    blackListDescription: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });
};


