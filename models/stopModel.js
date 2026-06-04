const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("stop", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    webTitle: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    placeId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    uetdsProvinceId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    uetdsDistrictId: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    isServiceArea: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  });
};
