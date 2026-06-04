const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("place", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    provinceId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    }
  });
};
