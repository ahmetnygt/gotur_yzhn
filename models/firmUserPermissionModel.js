const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define("firmuserpermission", {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    firmUserId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    permissionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    allow: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
  });
};
